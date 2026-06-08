# Architecture.md

# 系统架构

## 总体架构

GUI
↓
Decision Layer
↓
Knowledge Graph
↓
Agent Runtime

## Knowledge Graph

### Node

- Requirement
- Decision
- ADR
- Domain
- Module
- Service
- API
- Database
- Test
- File
- PR

### Edge

- depends_on
- implements
- affects
- originates_from
- validates
- related_to

## Agent Protocol

### 阶段

1. Analyze
2. Extract Decisions
3. Build Context Slice
4. User Review
5. Implement
6. Validate
7. Update Graph

## Skill System

### Built-in Skills

#### Decision Extractor

发现关键决策点。

#### Context Lens

提取最小必要上下文。

#### Blast Radius

分析影响范围。

#### Decision Replay

记录方案比较过程。

## Storage

### Graph Database

推荐：Neo4j

MVP：SQLite + Graph Layer

## GUI

### Decision Inbox

待决策事项

### Architecture Explorer

知识图谱浏览

### Context Lens

上下文聚焦

### Decision Timeline

决策历史追踪
