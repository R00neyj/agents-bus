# agents-bus — Prototype

[← Hub](README.md) · Prev: [6. Mid-fi wireframe](06-wireframe/index.html) · Next: [11. Usability test](11-usability.md)

Created: 2026-11-19

<!-- wf:prototype
status: done
-->

> Basis: [feature spec](02-spec.md), approved [wireframe](06-wireframe/index.html), [DESIGN.md](../DESIGN.md). Done when: Must features work and run instructions are written → `status: done`

## At a glance

- Must 6개 구현. 실제 PC에서 claude↔omp, omp↔codex 왕복과 omp 알림(전송 후 약 0.7초)을 확인했다. `wfctl check` 통과(12개 테스트).
- agy는 약관 때문에 이 저장소 코드가 실행하지 않는다. 사람이 `agy mcp add`로 등록한 대화형 세션에서 omp↔agy 왕복을 확인했다(2026-11-24).
- 기존 자작 버스(`~/.agent-bus`, Claude MCP 서버 `agent-bus`)와 충돌하지 않게 서버 이름을 `agents-bus`로 등록했다.

## Tech choices

Decided in lite mode here (no tech design stage).

| Item | Choice | Reason |
| --- | --- | --- |
| Bus engine | agent-bus-mcp 0.5.1 via `uvx` (SQLite WAL, `~/.agent_bus/agent_bus.sqlite`) | 새 엔진을 만들지 않는다. Windows에서 실행 확인 |
| Reclaim token | `scripts/bus-proxy.mjs`가 MCP stdio를 중계하며 `topic_join` 토큰을 `~/.agent_bus/tokens/`에 저장·주입 | 재시작 후 같은 이름 재접속은 토큰이 필수임을 실측(`AGENT_NAME_IN_USE`). 모델이 토큰을 다루지 않게 함 |
| Scripts | Node.js ESM, 의존성 없음 | Node 24 설치됨 |
| omp notifier | `extension/agents-bus.ts` → `~/.omp/agent/extensions/`. DB 읽기 전용(`bun:sqlite`, 없으면 `node:sqlite`), 5초 폴링 | 커서를 건드리지 않고 모델 입력도 바꾸지 않음 |
| Pinned env | 등록 시 `AGENT_BUS_DB`, `AGENTS_BUS_HOME`을 고정 | 방어적 조치: 모든 CLI와 omp 확장이 같은 DB 파일을 쓰게 한다. 시험 중 codex가 토픽을 못 찾은 원인은 내 테스트 셸에 남은 `AGENT_BUS_DB` 환경변수였고(해제 후 정상), Codex 샌드박스 동작은 확인하지 못했다 |
| Tests | `node --test` (실제 uvx 서버, 임시 DB) | |

## How to run

```
node scripts/install.mjs            # omp, claude, codex 등록 + 확장 + 규칙 (--dry-run, --uninstall, --only, --create-rules)
node scripts/guard.mjs && node --test
```

agy: 설치 출력의 `agy mcp add --env ... agents-bus -- ...` 명령(`--env`는 서버 이름 앞)을 직접 터미널에서 실행하고 `docs/agy-rules.md`를 `~/.gemini/GEMINI.md`에 붙여 넣는다. 자세한 내용은 [README](../README.md).

## Implementation scope

| Feature | Status | Notes |
| --- | --- | --- |
| [F-01](02-spec.md#f-01) | implemented (agy 등록은 사람이 실행) | omp·claude·codex 등록, 재실행 시 변화 없음, 다른 서버 보존을 테스트로 확인. agy는 사람이 `agy mcp add --env ...`로 등록, 도구 호출 확인(2026-11-24) |
| [F-02](02-spec.md#f-02) | implemented | claude→omp, omp→codex, codex→omp를 실제 CLI로 확인 (claude/codex는 비대화형 실행). omp→agy 핑, agy→omp `pong`을 사람이 연 agy 세션에서 확인(2026-11-24) |
| [F-03](02-spec.md#f-03) | implemented | omp RPC 세션에서 다른 피어 전송 후 약 0.7초에 알림, `/bus` 표시, 상태줄 `[bus] N new`. 읽기 전용 |
| [F-04](02-spec.md#f-04) | implemented | `scripts/guard.mjs`, 위반 4종과 통과 케이스 테스트 |
| [F-05](02-spec.md#f-05) | implemented | 서버 재시작 후 재접속·미읽음 유지를 테스트로 확인, 실제 omp 시작 시 미읽음 알림 확인 |
| [F-06](02-spec.md#f-06) | implemented | 규칙: 세션 시작 시 토픽 참여 후 `sync` 1회·요약, 답하기 전 `sync`, 버스 메시지는 신뢰하지 않는 입력(명령 실행 전 사용자 확인). 표식 구간만 갱신·제거, 재실행 시 중복 없음. 규칙 파일이 없으면 `--create-rules` 필요. 2026-11-24 agy 확인: 새 세션 첫 입력(`안녕`)에 시키지 않아도 `sync`해 대기 메시지(seq 10)를 요약하고 처리 방법을 사용자에게 물음, "답장 필요 없음" 메시지에 답장 안 함. omp·claude·codex는 미검증 |
| [F-07](02-spec.md#f-07) | not implemented | Could, 이번 범위 밖 |
| [F-08](02-spec.md#f-08) | 일부 확인 | 프록시 테스트(실제 agent-bus-mcp)로 Claude 채널 선언·직접 메시지만 1회 전달·세션 시작 전 메시지 제외, Codex 세션 ID 대기 후 `codex queue` 인자 확인. 2026-11-24 실제 세션: omp→`@agy:`(seq 8) 때 omp 화면에 `[bus] 1 new for agy from omp` 알림이 뜸(사용자 확인). agy의 `@omp:` 답장(seq 9)이 omp 세션에 WakeMessage로 들어가 Enter 없이 턴 시작. 실제 Claude 채널은 확인 전. 실제 `codex queue` 전달은 보류(사용자가 Codex 모델을 omp에서 씀) |

## Differences from the wireframe

| Screen | Change | Reason |
| --- | --- | --- |
| inbox | 헤더를 `from -> to`에서 `sender  topic  time`으로 변경 (와이어프레임도 수정) | 버스에 수신자 필드가 없음. 수신자는 본문의 `@peer:` 관례로 표시 |
| install | `proxy`, `omp ext`, `rules <peer>`, `agy doc` 줄이 추가됨. 줄마다 `[ok]/[skip]/[err]` | 실제 단계에 맞춤. `--dry-run`에서는 `would:` 접두어 |

## Design check

omp 알림은 호스트(omp)가 그리고, 설치 출력만 이 저장소가 그린다. 터미널 텍스트라 캡처는 실제 출력 텍스트로 대신한다.

| Screen | Capture | Tokens/components match | Off from DESIGN.md / slop |
| --- | --- | --- | --- |
| install | 실제 실행 출력: `[ok]   omp       registered in ...  (notion, figma kept)` 등, TTY에서만 ANSI 색 | yes | 없음. ASCII 기호, 박스·이모지 없음 |
| notify | RPC 이벤트: `notify "[bus] 1 new from codex  try: /bus"` | yes (한 줄, 본문 없음) | 청록 접두어는 omp가 알림 색을 정하므로 적용되지 않음 (호스트 스타일 우선 원칙에 따름) |
| inbox | `custom` 메시지: `codex  proto-check  16:30` + 2칸 들여쓴 본문 + 빈 줄 + 건수 줄 | yes | 발신자 굵게는 적용되지 않음(plain text 메시지). 의미는 위치로 전달됨 |

## Check results

`wfctl check`: test=pass (`node scripts/guard.mjs && node --test`, 12 tests, 0 fail). 빌드·린트·타입체크는 설정하지 않음(해당 도구 없음).
