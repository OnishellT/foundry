{
  description = "Portable Conversation Foundry learning loop";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  outputs = { self, nixpkgs }:
    let systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
        each = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in {
      packages = each (pkgs: { default = pkgs.stdenvNoCC.mkDerivation {
        pname = "conversation-foundry"; version = "1.0.0"; src = self;
        nativeBuildInputs = [ pkgs.makeWrapper ];
        installPhase = ''
          mkdir -p $out/share/conversation-foundry $out/bin
          cp -r foundry_loop skills examples docs LICENSE NOTICE VENDOR_PROVENANCE.json $out/share/conversation-foundry/
          makeWrapper ${pkgs.python3}/bin/python3 $out/bin/conversation-foundry \
            --set PYTHONPATH $out/share/conversation-foundry --set PYTHONSAFEPATH 1 --add-flags "-m foundry_loop"
        '';
      }; });
      devShells = each (pkgs: { default = pkgs.mkShell { packages = [ pkgs.python3 pkgs.git ]; }; });
      checks = each (pkgs: { tests = pkgs.runCommand "foundry-tests" { nativeBuildInputs = [ pkgs.python3 ]; } ''
        cp -r ${self} source; chmod -R u+w source; cd source
        export HOME=$TMPDIR
        python -m unittest discover -s tests -v
        touch $out
      ''; });
    };
}
