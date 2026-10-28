# ElseMesh schemas

This directory contains engine-level document schemas and portable component
contracts. Some component records currently supported by the source schema are
still specific to the built-in example world; extracting those validators into
the world-extension boundary remains part of the separation work. Renderer or
behavior documentation authored for one world belongs in that world's content
repository, alongside its source and package assets.

- [`world-source.schema.json`](world-source.schema.json): unsigned authoring
  document structure.
- [`world-proposal.schema.json`](world-proposal.schema.json): hash-bound,
  unsigned source edits.
- [`ai-edit-decision.schema.json`](ai-edit-decision.schema.json): local review
  decisions for AI-generated candidates.
- [`ambient-audio.md`](ambient-audio.md): signed ambience data.
- [`vegetation-placement.md`](vegetation-placement.md): portable placement
  records.
- [`water-body.md`](water-body.md): bounded terrain-independent water.
