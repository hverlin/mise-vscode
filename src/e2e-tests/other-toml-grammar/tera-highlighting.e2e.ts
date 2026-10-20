import { teraHighlightingSuite } from "../teraHighlightingSuite";

// the label loads another extension's TOML grammar after ours, see .vscode-test.js
teraHighlightingSuite("other");
