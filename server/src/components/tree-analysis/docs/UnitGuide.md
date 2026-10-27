# tree-analysis Guide

Enriches any workspace tree with review metadata by running Forge, workspace and codebase handlers. Its purpose is a visual mechanism pointing the developer at places needing more attention and away from places needing less.

## Notes

Not implemented yet.

Handlers run in a fixed order (Forge, then workspace, then codebase) over one tree and add metadata in place through the tree's metadata methods; later handlers see earlier results. Forge's built-in handlers live inside this unit. Analysis is computed once for the whole tree per request.

Every handler sees the whole tree. A codebase handler receives its codebase as context, not as a restriction, so rules such as "this path, inside that subtree" remain possible.

Measurements are handlers too: "Markdown larger than X KB" is a handler producing a warning signal; "this subtree is tests" is a handler de-emphasizing it. They read file sizes or content through a reader interface defined here and supplied by the caller for the tree's source, so analysis never depends on `tree-sources` and works unchanged for current changes, merge requests or the project tree.

Handlers are trusted project code. Do not sandbox them or validate their output beyond types; the cost of such protection is not justified for this tool.

Open: the handler signature, where codebase handler code lives and how it is loaded, precedence when handlers disagree, and whether handlers may define totals.
