# Third-Party Notices

## REVIT_MCP_study

Portions of `src/BimPersonalAgent.RevitBridge/Legacy` are derived from `shuotao/REVIT_MCP_study`, commit `cfe073951fa1e43792f9d93f015d7b82416df621`, with local Agent Gateway, queue, dynamic C# and policy changes.

Upstream repository: https://github.com/shuotao/REVIT_MCP_study

License declared by upstream: MIT License.

The original repository is retained separately for provenance and upstream comparison, but BIM Personal Agent does not load code or binaries from that sibling repository at runtime.

## Node.js

The Windows user release bundles the official Node.js win-x64 runtime so BIM engineers do not need a separate Node.js installation.

Project: https://nodejs.org/

License: MIT License. The official Node.js `LICENSE` file is included beside `node.exe` in the release package.

## Gateway npm dependencies

The Windows user release includes production dependencies declared in `gateway/package-lock.json`. Their package metadata and license files remain inside the bundled `node_modules` tree.
