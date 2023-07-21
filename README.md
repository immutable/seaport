# Seaport

A fork of ProjectOpenSea/seaport to enable the Immutable seaport fork.

## Upstream Management
`main` always tracks the upstream directly. Released Seaport versions are tagged and diffs to enable the Immutable fork are applied on top of these tags from base branches.

Note: For Seaport 1.5.0, the organizational code-split to seaport-core from seaport happened after the official 1.5.0 tag, which is why a commit-specific base was chosen after the split occurred.

## Deployment
Immutable do not deploy contracts from this repository directly, they are only used as references. Instead see immutable/immutable-seaport.
