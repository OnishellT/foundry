import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from foundry_loop.app import App
from foundry_loop.common import Invalid, js
from foundry_loop.ingest import register_source, scan_sources, create_episode
from foundry_loop.learning import derive, OBSERVATION_SCHEMA, SCHEMA


def proposal(ref):
    return {'name':'public-response-check','description':'Check public response','kind':'rule','scope':'domain','domain':'http',
            'positive':{'instructions':'Check through HTTP.','files':[]},'preventive':{'instructions':'Avoid relying only on internals.','files':[]},
            'evidence':[ref],'replaces':[],'rationale':'Observable behavior is the acceptance boundary.'}


class LongLearningTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.app=App(self.root/'state');self.store=self.app.store
        cfg=self.store.get('config');cfg.update(auto_derive=False,max_input_chars=5000,max_calls=36,experiment_seconds=60);self.store.set('config',cfg)
        self.calls=[];self.refs=[]

    def tearDown(self):
        self.store.db.close();self.temp.cleanup()

    def episode(self,texts,first_event=0):
        path=self.root/'source.jsonl';path.write_text(''.join(js({'role':'user' if i==0 else 'assistant','text':text,'native_data':{'note':'evidence'}})+'\n' for i,text in enumerate(texts)))
        register_source(self.store,path,'canonical');scan_sources(self.store)
        session=self.store.one('SELECT * FROM sessions')
        episode=create_episode(self.store,session['id'],first_event=first_event)
        self.app.action({'action':'episode.complete','id':episode['id'],'completed':True})
        self.app.action({'action':'episode.label','id':episode['id'],'label':'correct','feedback':'User confirmed acceptance.'})
        return episode['id']

    def job(self,episode):
        id=self.store.job('derive',episode);self.store.claim();return id

    def driver(self,config,prompt,cwd,*,cancel=None,schema=None):
        self.assertLessEqual(len(prompt),self.store.get('config')['max_input_chars'])
        data=json.loads(prompt.split('\nEVIDENCIA_JSON\n',1)[1]);self.calls.append((schema,data,prompt))
        if schema==OBSERVATION_SCHEMA:
            text_parts=[f for f in data['fragments'] if f['part']=='text' and f['text'].strip()]
            observations=[]
            if text_parts:
                part=text_parts[0];ref={'event_index':part['event_index'],'quote':part['text'][:20]}
                self.refs.append(ref);observations=[{'observation':'Observable acceptance evidence.', 'evidence':[ref]}]
            value={'observations':observations}
        else:
            self.assertEqual(schema,SCHEMA)
            if 'observations' in data:
                self.assertNotIn('events',data)
                self.assertEqual(data['feedback'],'User confirmed acceptance.')
                ref=data['observations'][0]['evidence'][0]
            else:ref={'event_index':0,'quote':data['events'][0]['text'][:20]}
            value=proposal(ref)
        return {'text':js(value),'usage':{'input_tokens':1,'output_tokens':1},'seconds':.01,'provider':'command','model':'protocol-test','real_inference':False}

    def test_long_episode_covers_every_character_and_keeps_global_indices(self):
        texts=['Ignored prior task.']+['Event '+str(i)+' requires checks. '+('α response text '*55) for i in range(18)]
        episode=self.episode(texts,first_event=1);job=self.job(episode)
        with patch('foundry_loop.learning.run_agent',side_effect=self.driver):result=derive(self.store,episode,job)
        spec=json.loads(result['spec']);coverage=spec['analysis_coverage']
        self.assertEqual(coverage['mode'],'chunked_evidence_synthesis');self.assertEqual(coverage['event_count'],18)
        chunks=[data for schema,data,_ in self.calls if schema==OBSERVATION_SCHEMA]
        self.assertGreater(len(chunks),2)
        for index,original in enumerate(texts[1:]):
            fragments=[f for data in chunks for f in data['fragments'] if f['event_index']==index and f['part']=='text']
            self.assertEqual(''.join(f['text'] for f in fragments),original)
            self.assertEqual(fragments[0]['start'],0);self.assertEqual(fragments[-1]['end'],len(original))
            self.assertTrue(all(f['session_event_index']==index+1 for f in fragments))
        synthesis=[data for schema,data,_ in self.calls if schema==SCHEMA][0]
        self.assertEqual(len(synthesis['observations']),len(self.refs))
        self.assertIn('no equivale',coverage['interpretation'])

    def test_completion_gate_is_enforced_without_ui(self):
        episode=self.episode(['Check response']); job=self.job(episode)
        self.store.execute('UPDATE task_completions SET completed=0 WHERE episode_id=?',(episode,))
        for selected_job in (None,job):
            with patch('foundry_loop.learning.run_agent') as provider,self.assertRaisesRegex(Invalid,'completada'):
                derive(self.store,episode,selected_job)
            provider.assert_not_called()

    def test_reconfirmation_during_extraction_prevents_result_commit(self):
        episode=self.episode(['Check response']); job=self.job(episode)
        def revoke(*args,**kwargs):
            result=self.driver(*args,**kwargs)
            self.store.execute('UPDATE task_completions SET generation=? WHERE episode_id=?',('reconfirmed',episode))
            return result
        with patch('foundry_loop.learning.run_agent',side_effect=revoke),self.assertRaisesRegex(Invalid,'cambió'):
            derive(self.store,episode,job)
        self.assertFalse(self.store.rows('SELECT * FROM candidates'))

    def test_incorrect_evidence_generates_preventive_pending_proposal(self):
        episode=self.episode(['Check response'])
        self.app.action({'action':'episode.label','id':episode,'label':'incorrect','feedback':'User confirmed acceptance.'})
        job=self.job(episode)
        with patch('foundry_loop.learning.run_agent',side_effect=self.driver): result=derive(self.store,episode,job)
        spec=json.loads(result['spec'])
        self.assertEqual(spec['preferred_variant'],'preventive')
        self.assertEqual(spec['completion_generation'],self.store.task_completion(episode)['completion_generation'])
        self.assertEqual(self.calls[0][1]['preferred_variant'],'preventive')
        self.assertEqual(result['status'],'proposed'); self.assertEqual(self.store.get('active_version'),'initial')

    def test_single_oversized_event_is_split_without_omission(self):
        text='Check response with Unicode ñ. '+('chunk content '*1300)
        episode=self.episode([text]);job=self.job(episode)
        with patch('foundry_loop.learning.run_agent',side_effect=self.driver):result=derive(self.store,episode,job)
        chunks=[data for schema,data,_ in self.calls if schema==OBSERVATION_SCHEMA]
        fragments=[f for data in chunks for f in data['fragments'] if f['part']=='text']
        self.assertGreater(len(fragments),2)
        self.assertEqual(''.join(f['text'] for f in fragments),text)
        self.assertTrue(all(f['event_index']==0 for f in fragments))
        self.assertEqual(json.loads(result['spec'])['analysis_coverage']['event_count'],1)

    def test_retry_reuses_completed_chunks_without_duplicate_calls(self):
        episode=self.episode(['Check response. '+('data '*2400)]);job=self.job(episode)
        successful=[];failed=[False]
        def interruption(*args,**kwargs):
            data=json.loads(args[1].split('\nEVIDENCIA_JSON\n',1)[1])
            if kwargs['schema']==OBSERVATION_SCHEMA and data['chunk_index']==1 and not failed[0]:
                failed[0]=True;raise Invalid('Transient provider failure')
            result=self.driver(*args,**kwargs)
            if kwargs['schema']==OBSERVATION_SCHEMA:successful.append(data['chunk_index'])
            return result
        with patch('foundry_loop.learning.run_agent',side_effect=interruption),self.assertRaises(Invalid):derive(self.store,episode,job)
        self.store.execute("UPDATE jobs SET status='failed' WHERE id=?",(job,))
        nextjob=self.job(episode)
        with patch('foundry_loop.learning.run_agent',side_effect=interruption):derive(self.store,episode,nextjob)
        self.assertEqual(successful.count(0),1)
        self.assertEqual(len(successful),len(set(successful)))

    def test_completed_synthesis_checkpoint_survives_candidate_write_failure(self):
        episode=self.episode(['Check response. '+('data '*2400)]);job=self.job(episode)
        original=self.store.execute
        def fail_candidate(sql,args=()):
            if sql.startswith('INSERT INTO candidates'):raise RuntimeError('simulated DB write boundary failure')
            return original(sql,args)
        with patch('foundry_loop.learning.run_agent',side_effect=self.driver),patch.object(self.store,'execute',side_effect=fail_candidate),self.assertRaises(RuntimeError):
            derive(self.store,episode,job)
        self.store.execute("UPDATE jobs SET status='failed' WHERE id=?",(job,))
        nextjob=self.job(episode)
        with patch('foundry_loop.learning.run_agent',side_effect=AssertionError('Completed paid calls must be reused')) as provider:
            result=derive(self.store,episode,nextjob)
        provider.assert_not_called()
        self.assertEqual(result['status'],'proposed')

    def test_synthesis_cannot_introduce_unobserved_original_quote(self):
        episode=self.episode(['Check response. '+('data '*2400)]);job=self.job(episode)
        def unobserved(*args,**kwargs):
            result=self.driver(*args,**kwargs)
            if kwargs['schema']==SCHEMA:
                value=json.loads(result['text']);value['evidence']=[{'event_index':0,'quote':'data data data'}]
                result['text']=js(value)
            return result
        with patch('foundry_loop.learning.run_agent',side_effect=unobserved),self.assertRaisesRegex(Invalid,'observaciones verificadas'):
            derive(self.store,episode,job)
        self.assertEqual(self.store.rows('SELECT * FROM candidates'),[])

    def test_label_change_prevents_checkpoint_and_synthesis(self):
        episode=self.episode(['Check response. '+('data '*2400)]);job=self.job(episode)
        def revoke(*args,**kwargs):
            result=self.driver(*args,**kwargs)
            self.app.action({'action':'episode.label','id':episode,'label':'incorrect'})
            return result
        with patch('foundry_loop.learning.run_agent',side_effect=revoke),self.assertRaises(Invalid):derive(self.store,episode,job)
        self.assertEqual(self.store.rows("SELECT key FROM kv WHERE key LIKE 'learning_chunk:%'"),[])
        self.assertEqual(self.store.rows('SELECT * FROM candidates'),[])
        self.assertTrue(all(schema==OBSERVATION_SCHEMA for schema,_,_ in self.calls))

    def test_fabricated_chunk_quote_is_rejected(self):
        episode=self.episode(['Check response. '+('data '*2400)]);job=self.job(episode)
        def fabrication(*args,**kwargs):
            return {'text':js({'observations':[{'observation':'Invented','evidence':[{'event_index':0,'quote':'This text never existed.'}]}]})}
        with patch('foundry_loop.learning.run_agent',side_effect=fabrication),self.assertRaises(Invalid):derive(self.store,episode,job)
        self.assertEqual(self.store.rows("SELECT key FROM kv WHERE key LIKE 'learning_chunk:%'"),[])

    def test_budget_preflight_and_oversized_synthesis_are_explicit(self):
        episode=self.episode(['Check response. '+('data '*2400)]);job=self.job(episode)
        cfg=self.store.get('config');cfg['max_calls']=2;self.store.set('config',cfg)
        with patch('foundry_loop.learning.run_agent',side_effect=self.driver) as provider,self.assertRaises(Invalid):derive(self.store,episode,job)
        provider.assert_not_called()
        cfg['max_calls']=36;self.store.set('config',cfg)
        def verbose(*args,**kwargs):
            result=self.driver(*args,**kwargs)
            if kwargs['schema']==OBSERVATION_SCHEMA:
                value=json.loads(result['text'])
                for obs in value['observations']:obs['observation']='A'*3500
                result['text']=js(value)
            return result
        with patch('foundry_loop.learning.run_agent',side_effect=verbose),self.assertRaisesRegex(Invalid,'observaciones exceden'):derive(self.store,episode,job)
        self.assertTrue(self.store.rows("SELECT key FROM kv WHERE key LIKE 'learning_chunk:%'"))
        self.assertEqual(self.store.rows('SELECT * FROM candidates'),[])


if __name__=='__main__':unittest.main()
