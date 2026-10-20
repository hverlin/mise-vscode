import { teraHighlightingSuite } from "../teraHighlightingSuite";

// simulates another TOML extension installed next to ours, whose grammar
// wins over ours (see .vscode-test.js)
teraHighlightingSuite("another extension");
