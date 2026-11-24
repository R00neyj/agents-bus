# agents-bus — Overall flow

Started: 2026-11-18

This document is the project hub. Follow the links in the table below to each stage's detail document.
The inside of the `<!-- wf:index -->` block is redrawn by `wfctl sync` from the stage documents' markers — do not edit it by hand.

## Overview

- One-line definition: 한 PC의 omp, Claude Code, Codex, Antigravity가 서로 메시지를 주고받는 로컬 버스 (기존 도구 채택 + omp 알림 확장)
- Target users: 본인 1인, 한 PC에서 터미널 여러 개
- Current goal: 4개 CLI 송수신 + omp 자동 알림. agy는 사람이 연 대화형 세션으로만 참여 (약관)

## Progress

<!-- wf:index:begin -->
Mode: **lite**

| Phase | # | Doc | Status | Skill |
| --- | --- | --- | --- | --- |
| Planning | 1 | [Research & brief](01-brief.md) | done | `/wf-brief` |
| Planning | 2 | [Feature spec](02-spec.md) | done | `/wf-spec` |
| UX | 3 | [UX flowchart](03-flow.md) | done | `/wf-flow` |
| UI | 4 | [UI references](04-references.md) | skipped (lite) | `/wf-references` |
| UI | 5 | [Design system (DESIGN.md)](../DESIGN.md) | done | `/wf-design` |
| UI | 6 | [Mid-fi wireframe](06-wireframe/index.html) | done | `/wf-wireframe` |
| UI | 7 | [Wireframe review](07-wireframe-review.md) | skipped (lite) | `/wf-wireframe-review` |
| UI | 8 | [Styled key screens](08-ui-sample.md) | skipped (lite) | `/wf-ui-sample` |
| Development | 9 | [Tech design](09-tech.md) | skipped (lite) | `/wf-tech` |
| Development | 10 | [Prototype](10-prototype.md) | done | `/wf-prototype` |
| Development | 11 | [Usability test](11-usability.md) | not started ◀ now | `/wf-usability` |
| Development | 12 | [Hardening & verification](12-hardening.md) | not started | `/wf-hardening` |
| Release | 13 | [Pre-release](13-prerelease.md) | skipped (lite) | `/wf-prerelease` |
| Release | 14 | [Internal test](14-internal-test.md) | skipped (lite) | `/wf-internal-test` |
| Release | 15 | [Release](15-release.md) | not started | `/wf-release` |

Next up: **11. Usability test** → `/wf-usability`
<!-- wf:index:end -->

## Decision log

Add one line each time a stage ends or the direction changes. Link the supporting document.

| Date | Stage | Decision | Basis |
| --- | --- | --- | --- |
| 2026-11-18 | - | Workflow started | - |
| 2026-11-18 | 1 Brief | 새 버스를 만들지 않고 기존 도구(우선 agent-bus-mcp)를 채택. agy는 사람이 연 대화형 세션 + MCP로만 참여 (래핑·`agy -p` 금지) | [01-brief.md](01-brief.md#4-reference-research) |
| 2026-11-18 | 2 Spec | Must 6(F-01~F-06), Could 1(F-07), Core는 F-01·F-02·F-03. lite 모드로 전환, 단계마다 확인 | [02-spec.md](02-spec.md) |
| 2026-11-19 | 3 Flow | 화면 3개(install, notify, inbox). omp는 `/bus` 슬래시 명령으로 메시지를 직접 표시, 설치는 `node scripts/install.mjs` 한 줄 | [03-flow.md](03-flow.md) |
| 2026-11-19 | 5 Design | 터미널 텍스트 UI: ANSI 청록 `[bus]` 접두어, ASCII 기호(`[ok] [skip] [err]`), 메시지 사이 빈 줄. 컴포넌트 4개. 4단계 레퍼런스는 lite라 생략 | [DESIGN.md](../DESIGN.md) |
| 2026-11-19 | 6 Wireframe | 화면 3개를 터미널 텍스트 목업(HTML)으로 작성. 설치 스크립트는 agy를 실행하지 않고 `agy mcp add` 명령만 출력해 사람이 직접 실행 | [06-wireframe/index.html](06-wireframe/index.html) |
| 2026-11-19 | 10 Prototype | agent-bus-mcp 0.5.1을 `uvx`로 채택 확정(Windows 실행·claude/omp/codex 왕복 확인). 재접속 토큰 보관용 프록시 `bus-proxy.mjs` 추가, omp 알림은 읽기 전용 확장 + `/bus`. 서버 이름은 기존 자작 버스와 분리해 `agents-bus`. 4단계·7·8·9는 lite 모드로 생략, 기술 선택은 10단계 문서에 기록 | [10-prototype.md](10-prototype.md) |
| 2026-11-19 | 10 Prototype | agy 왕복은 약관상 코드로 검증하지 않음. 사람이 `agy mcp add`를 실행해 확인한다 | [10-prototype.md](10-prototype.md#implementation-scope) |
| 2026-11-24 | - | 이름이 겹치는 옛 자작 버스 `agent-bus`(`~/.agent-bus`) 은퇴: Claude Code 등록 제거(완료). 폴더는 실행 중인 Claude 세션이 잡고 있어 세션 종료 후 `~/.agent-bus.bak`으로 이름 변경 예정. 이 버스 이름 `agents-bus`는 유지 | [README.md](../README.md#참고) |
| 2026-11-24 | 10 Prototype | omp↔agy 왕복 확인: 사람이 `agy mcp add --env ...`로 등록, agy 참여(12:29) 후 omp 핑(seq 4)에 agy가 `@omp: pong`(seq 5, reply_to 지정)으로 답함. agy 메시지에 omp 알림이 뜬 것을 사용자가 화면에서 확인 | [10-prototype.md](10-prototype.md#implementation-scope) |
| 2026-11-24 | 10 Prototype | F-08 추가: `@<peer>:` 메시지를 열린 세션에 자동 전달(Claude channels 방식). omp는 확장이 턴 시작, Claude는 프록시가 채널 이벤트(`--dangerously-load-development-channels server:agents-bus` 필요), Codex는 프록시가 `codex queue`(세션 ID는 Codex MCP 도구 훅). agy는 약관으로 제외. F-03의 "본문을 모델에 넣지 않음" 원칙은 직접 메시지에 한해 바꿈. 서로 깨우는 무한 답장은 규칙으로 막음 | [02-spec.md F-08](02-spec.md#f-08) |
| 2026-11-24 | 10 Prototype | agy 확인 완료: `@agy:` 메시지에 omp 화면 알림, agy 새 세션 첫 입력에 시키지 않아도 `sync`·요약, 요청 없는 메시지에 답장 안 함, agy 답장이 omp 세션에 저절로 들어가 턴 시작. Codex CLI 자동 전달(`codex queue`) 실제 확인은 보류: 사용자가 Codex 모델을 omp에서 쓸 수 있어 급하지 않음(agy는 omp에서 쓰면 약관 위반이라 별도 CLI가 필요). 코드와 훅은 남겨 둠 | [10-prototype.md](10-prototype.md#implementation-scope) |
| 2026-11-24 | 10 Prototype | agy 자동 참여 장치(`PreInvocation` 훅으로 새 메시지 알림, `schedule`, `Stop` 훅 대기)는 2026-12-02 이후로 보류. 구독 로그인에서는 다른 에이전트·자동 루프·대기열이 agy를 움직이는 것이 개인 용도라도 금지(Google 답변 2026-11-12). Google이 12월 2일 "첫 단계"를 예고해 정책이 바뀔 수 있음. 그때까지 agy는 사람이 "버스 확인해"로 받음 | [antigravity-cli#1493](https://github.com/google-antigravity/antigravity-cli/issues/1493), [Logan Kilpatrick 2026-11-20](https://twitter.com/OfficialLoganK/status/2123657759896007035) |
| 2026-11-24 | 10 Prototype | 세션 이름 주소: 같은 CLI 여러 세션이 피어 이름 하나를 공유해 커서·깨우기가 섞이던 문제 해결. 이름 있는 세션은 `CLI.세션이름`. 이름 전달: omp는 확장이 모든 버스 도구 호출에 `agents_bus_session` 인자를 붙임(omp는 MCP 서버를 공유 데몬에서 띄워 프록시가 세션을 구분 못 함, 부모 pid 방식 불가 확인), Claude는 `UserPromptSubmit` mcp_tool 훅의 `session_title`, Codex는 프록시가 `session_index.jsonl` 스레드 이름 조회, agy는 규칙 안내만. 참여 뒤 이름이 바뀌면 프록시가 재참여하고 읽은 위치(cursor)를 이어받음, 그동안 클라이언트 요청은 보류. `@omp.X:`는 그 세션만, `@omp:`는 한 세션만. 실제 omp RPC(`omp.첫-이름`→`omp.후속-이름`)·Claude `-p --name`(`claude.클로드-검증`)으로 확인, Codex는 테스트만 | [README.md](../README.md#같은-cli를-여러-개-띄울-때-세션-이름) |

## Open questions

Once answered, move to the decision log and delete here.

- 세션 시작 규칙(참여·sync 요약)을 실제 claude/codex/omp 세션이 따르는지 사용성 테스트에서 확인 ([02-spec.md F-06](02-spec.md#f-06))
- 2026-12-02 Google 발표 확인 후 agy 자동 참여 방식 결정: 구독을 다른 도구에서 허용하면 omp에서 Gemini 사용(agy 전용 장치 불필요), 아니면 `PreInvocation` 훅(메시지당 한 번만 알림, 사람 입력 필요). `schedule`·`Stop` 훅 대기는 구독 로그인에서 쓰지 않음
