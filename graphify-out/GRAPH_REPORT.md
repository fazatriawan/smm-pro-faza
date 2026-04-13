# Graph Report - C:\Users\User\.claude  (2026-04-13)

## Corpus Check
- Corpus is ~6,329 words - fits in a single context window. You may not need a graph.

## Summary
- 49 nodes · 56 edges · 7 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Extraction Pipeline|Extraction Pipeline]]
- [[_COMMUNITY_Export & Output|Export & Output]]
- [[_COMMUNITY_Core Philosophy|Core Philosophy]]
- [[_COMMUNITY_Detection & Transcription|Detection & Transcription]]
- [[_COMMUNITY_Graph Building|Graph Building]]
- [[_COMMUNITY_Caching & Ingestion|Caching & Ingestion]]
- [[_COMMUNITY_Query & Traversal|Query & Traversal]]

## God Nodes (most connected - your core abstractions)
1. `Part B - Semantic Extraction via Subagents` - 7 edges
2. `Step 4 - Build Graph, Cluster, Analyze` - 7 edges
3. `Step 6 - Generate Obsidian Vault and HTML` - 7 edges
4. `Graphify Pipeline` - 5 edges
5. `Part A - AST Structural Extraction` - 5 edges
6. `Persistent Graph Storage` - 4 edges
7. `Step 2 - Detect Files` - 4 edges
8. `Step 3 - Extract Entities and Relationships` - 4 edges
9. `Part C - Merge AST and Semantic` - 4 edges
10. `Honest Audit Trail` - 3 edges

## Surprising Connections (you probably didn't know these)
- `Graphify Skill Reference` --references--> `Graphify Pipeline`  [EXTRACTED]
  .claude/CLAUDE.md → .claude/skills/graphify/SKILL.md
- `Native CLAUDE.md Integration` --conceptually_related_to--> `Graphify Skill Reference`  [INFERRED]
  .claude/skills/graphify/SKILL.md → .claude/CLAUDE.md

## Hyperedges (group relationships)
- **Graphify Full Pipeline Steps** — SKILL_step1_install, SKILL_step2_detect, SKILL_step3_extract, SKILL_step4_build_cluster, SKILL_step5_label_communities, SKILL_step6_outputs, SKILL_step9_manifest_cleanup [EXTRACTED 1.00]
- **Graph Query and Exploration Capabilities** — SKILL_query_traversal, SKILL_shortest_path, SKILL_explain_node [EXTRACTED 1.00]
- **Entity Extraction Dual Pipeline** — SKILL_step3a_ast_extraction, SKILL_step3b_semantic_extraction, SKILL_step3c_merge, SKILL_extraction_cache [EXTRACTED 1.00]

## Communities

### Community 0 - "Extraction Pipeline"
Cohesion: 0.24
Nodes (11): Git Commit Hook Integration, graphify.extract Module, graphify.watch Module, Hyperedge Concept, Rationale Extraction, Semantic Similarity Edges, Step 3 - Extract Entities and Relationships, Part A - AST Structural Extraction (+3 more)

### Community 1 - "Export & Output"
Cohesion: 0.18
Nodes (11): graphify.benchmark Module, graphify.export Module, graphify.serve Module, Step 5 - Label Communities, Step 6 - Generate Obsidian Vault and HTML, Step 7 - Neo4j Export, Step 7b - SVG Export, Step 7c - GraphML Export (+3 more)

### Community 2 - "Core Philosophy"
Cohesion: 0.29
Nodes (8): Graphify Skill Reference, Honest Audit Trail, Native CLAUDE.md Integration, Community Detection, Confidence Tagging System, Graphify Pipeline, Honesty Rules, Karpathy Raw Folder Workflow

### Community 3 - "Detection & Transcription"
Cohesion: 0.4
Nodes (5): graphify.detect Module, graphify.transcribe Module, Step 1 - Ensure Graphify Installed, Step 2.5 - Transcribe Video/Audio, Step 2 - Detect Files

### Community 4 - "Graph Building"
Cohesion: 0.4
Nodes (5): graphify.analyze Module, graphify.build Module, graphify.cluster Module, graphify.report Module, Step 4 - Build Graph, Cluster, Analyze

### Community 5 - "Caching & Ingestion"
Cohesion: 0.4
Nodes (5): Add URL to Corpus, Extraction Cache, graphify.cache Module, graphify.ingest Module, Incremental Update Mode

### Community 6 - "Query & Traversal"
Cohesion: 0.83
Nodes (4): Explain Node Query, Persistent Graph Storage, Graph Query Traversal (BFS/DFS), Shortest Path Query

## Knowledge Gaps
- **22 isolated node(s):** `Step 1 - Ensure Graphify Installed`, `Step 7 - Neo4j Export`, `Step 7b - SVG Export`, `Step 7c - GraphML Export`, `Step 9 - Save Manifest and Clean Up` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Step 4 - Build Graph, Cluster, Analyze` connect `Graph Building` to `Extraction Pipeline`, `Export & Output`, `Core Philosophy`?**
  _High betweenness centrality (0.648) - this node is a cross-community bridge._
- **Why does `Part C - Merge AST and Semantic` connect `Extraction Pipeline` to `Graph Building`?**
  _High betweenness centrality (0.432) - this node is a cross-community bridge._
- **Why does `Graphify Pipeline` connect `Core Philosophy` to `Query & Traversal`?**
  _High betweenness centrality (0.387) - this node is a cross-community bridge._
- **What connects `Step 1 - Ensure Graphify Installed`, `Step 7 - Neo4j Export`, `Step 7b - SVG Export` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._