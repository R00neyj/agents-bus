# agents-bus — Feature spec

[← Hub](README.md) · Prev: [1. Research & brief](01-brief.md) · Next: [3. UX flowchart](03-flow.md)

Created: 2026-11-18

<!-- wf:spec
status: done
-->

> Basis: [brief](01-brief.md). Done when: every feature has acceptance criteria and at least one feature is marked core → `status: done`
> Features marked **Core** become the tasks of the stage 11 usability test.

## At a glance

- Must 7개: 설치·연결, 송수신, omp 자동 알림, agy 약관 가드, 재시작 후 유지, 사용 규칙, 열린 세션에 자동 전달(F-08, 2026-11-24 추가). Could 1개: 상태 점검.
- Core(사용성 테스트 과제) 3개: F-01, F-02, F-03.
- 버스 엔진은 기존 agent-bus-mcp를 채택한다. 이 저장소가 직접 만드는 것은 설치 스크립트, omp 확장, 가드 검사, 규칙 문구다.

## Feature list

| ID | Feature | Core | Priority | Source (brief section) |
| --- | --- | --- | --- | --- |
| [F-01](#f-01) | 버스 설치와 4개 CLI 연결 | Y | Must | [Brief section 5](01-brief.md#5-target-outcome) |
| [F-02](#f-02) | CLI 간 송수신 | Y | Must | [Brief section 5](01-brief.md#5-target-outcome) |
| [F-03](#f-03) | omp 자동 알림 | Y | Must | [Brief section 6](01-brief.md#6-success-criteria) |
| [F-04](#f-04) | agy 약관 가드 | N | Must | [Brief section 6](01-brief.md#6-success-criteria) |
| [F-05](#f-05) | 재시작 후 메시지 유지 | N | Must | [Brief section 6](01-brief.md#6-success-criteria) |
| [F-06](#f-06) | 사용 규칙 설치 | N | Must | [Brief section 5](01-brief.md#5-target-outcome) |
| [F-07](#f-07) | 상태 점검(doctor) | N | Could | - (제안) |
| [F-08](#f-08) | 열린 세션에 자동 전달 (채널식) | N | Must | - (사용자 요청 2026-11-24) |

Priority: Must (required for release) / Should / Could / Won't (excluded this time)

## Feature details

<a id="f-01"></a>

### F-01 버스 설치와 4개 CLI 연결

- User: 본인
- Purpose: 한 번의 실행으로 버스를 쓸 수 있는 상태를 만든다.
- Input: 설치 명령 (대상 CLI 선택, 기본 omp·claude·codex·agy)
- Behavior: agent-bus-mcp를 `uvx`로 실행하도록 각 CLI의 MCP 설정에 등록한다. omp는 `~/.omp/agent/mcp.json` 편집, 나머지는 각 CLI의 `mcp add`.
- Output/result: 각 CLI에서 버스 도구 목록이 보인다.
- Exceptions: 이미 등록됨(덮어쓰지 않고 건너뜀), CLI 미설치(건너뛰고 알림), `uvx` 없음(중단하고 안내)
- Acceptance criteria:
  - [ ] 4개 CLI 모두에서 버스 도구가 호출 가능하다.
  - [ ] 재실행해도 기존 설정을 망가뜨리지 않는다(멱등).
  - [ ] 다른 서버(예: omp의 notion) 설정은 보존된다.

<a id="f-02"></a>

### F-02 CLI 간 송수신

- User: 본인
- Purpose: omp에서 다른 CLI로 일을 넘기고 답을 받는다.
- Input: 토픽 이름, 피어 이름, 메시지
- Behavior: 각 CLI가 고정 피어 이름으로 같은 토픽에 참여해 `sync()`로 보내고 받는다.
- Output/result: 한 CLI에서 보낸 메시지를 다른 CLI가 읽고 답한다.
- Exceptions: 피어 이름 중복(재접속 토큰으로 복구), 토픽 없음(생성)
- Acceptance criteria:
  - [ ] omp↔claude, omp↔codex, omp↔agy 왕복이 각각 1회 성공한다.
  - [ ] 보낸 쪽과 받은 쪽 이름이 메시지에 표시된다.

<a id="f-03"></a>

### F-03 omp 자동 알림

- User: 본인 (omp 사용 중)
- Purpose: 다른 CLI의 응답을 물어보지 않아도 알게 된다.
- Input: 버스 저장소(SQLite)의 새 메시지
- Behavior: omp 확장이 읽기 전용으로 새 메시지를 감시해 상태줄·알림으로 표시한다. `@omp:`로 omp를 지정한 새 메시지는 [F-08](#f-08)에 따라 세션에 전달되고 턴을 시작한다. 그 밖의 메시지는 알림만 띄운다.
- Output/result: "새 메시지 N건 (발신자)" 표시.
- Exceptions: DB 없음(조용히 대기), 읽기 잠금(재시도), 확장 로드 실패(omp 동작에 영향 없음)
- Acceptance criteria:
  - [ ] 다른 CLI가 메시지를 보내면 10초 안에 omp에 알림이 뜬다.
  - [ ] 확장은 DB를 쓰지 않는다(읽기 전용).
  - [ ] 확장을 꺼도 omp와 버스가 정상 동작한다.

<a id="f-04"></a>

### F-04 agy 약관 가드

- User: 본인
- Purpose: Antigravity 계정이 다시 차단되지 않게 한다.
- Input: 이 저장소 코드와 설정
- Behavior: `agy` 실행·`agy -p`·자격증명 파일 접근 문자열이 코드에 없는지 검사하는 스크립트를 `checks`에 넣는다. 설치 스크립트는 agy에 MCP 등록만 하고 실행하지 않는다.
- Output/result: 통과 또는 위반 위치 목록.
- Exceptions: 문서의 설명 문구(허용 목록으로 제외)
- Acceptance criteria:
  - [ ] 위반 문자열을 넣으면 검사가 실패한다.
  - [ ] 현재 저장소에서는 통과한다.

<a id="f-05"></a>

### F-05 재시작 후 메시지 유지

- User: 본인
- Purpose: 세션을 닫아도 대화 맥락이 남는다.
- Input: 읽지 않은 메시지가 있는 상태에서 CLI 재시작
- Behavior: agent-bus-mcp의 서버 측 커서와 SQLite 영속성을 그대로 사용한다.
- Output/result: 재접속 후 읽지 않은 메시지를 받는다.
- Exceptions: 피어 이름 충돌(재접속 토큰)
- Acceptance criteria:
  - [ ] 수신자를 종료한 상태에서 보낸 메시지가 재시작 후 수신된다.

<a id="f-06"></a>

### F-06 사용 규칙 설치

- User: 본인
- Purpose: 알림이 없는 CLI(agy 등)가 버스를 확인·응답하는 습관을 갖게 한다.
- Input: 대상 CLI의 규칙/지침 파일 위치
- Behavior: 각 CLI에 "시작 시 토픽 참여, 응답 전 인박스 확인" 같은 짧은 규칙 블록을 표식 주석 사이에 추가한다.
- Output/result: 규칙 블록이 적용된다. 제거 시 표식 구간만 지운다.
- Exceptions: 파일 없음(생성하지 않고 안내), 이미 있음(갱신)
- Acceptance criteria:
  - [ ] 표식 구간 밖의 기존 내용은 변하지 않는다.
  - [ ] 재실행해도 중복되지 않는다.

<a id="f-07"></a>

### F-07 상태 점검(doctor)

- User: 본인
- Purpose: 연결이 안 될 때 원인을 한 번에 본다.
- Input: 없음
- Behavior: 4개 CLI의 등록 여부, `uvx` 존재, DB 경로를 점검해 표로 출력한다.
- Output/result: 항목별 OK/없음.
- Exceptions: -
- Acceptance criteria:
  - [ ] 등록이 빠진 CLI를 지목해 알려준다.

<a id="f-08"></a>

### F-08 열린 세션에 자동 전달 (채널식)

- User: 본인
- Purpose: "버스 확인해"라고 말하지 않아도, 열려 있는 CLI 세션이 자기에게 온 메시지를 받아 처리한다 (Claude Code channels처럼).
- Input: 버스 DB의 새 메시지 중 `@<peer>:`로 그 피어를 지정한 것
- Behavior: DB를 읽기 전용으로 감시해 열린 세션에 전달한다. omp는 확장이 세션 메시지로 넣고 턴을 시작한다. Claude Code는 프록시가 채널(`notifications/claude/channel`)로 보낸다(`claude --dangerously-load-development-channels server:agents-bus`로 실행해야 함). Codex는 프록시가 `codex queue --thread <세션>`을 실행하고, 세션 ID는 Codex 훅(`SessionStart`, `UserPromptSubmit`)이 MCP 도구 `bus_register_session`으로 알려 준다. agy는 약관 때문에 전달하지 않는다(가져오기만).
- Output/result: 세션에 `[bus] 보낸이 -> 받는이  토픽` 형태로 메시지가 들어오고 모델이 처리한다. 읽음 처리는 모델의 `sync`가 한다.
- Exceptions: `@all:`·수신자 없는 메시지(전달 안 함, 다음 sync에서 받음), 세션 시작 전에 이미 와 있던 메시지(세션 시작 sync가 처리), Codex 세션 ID 모름(알 때까지 보관), 채널 미허용 실행(Claude가 조용히 무시, 가져오기로 동작), 같은 피어 세션 여러 개(`~/.agent_bus/wakes/` 표시 파일을 먼저 만든 한 세션만 깸), 같은 발신자가 10분에 3번 넘게 깨움(넘는 것은 전달 안 함, 다음 sync에서 받음)
- Acceptance criteria:
  - [ ] `@claude:`·`@codex:`·`@omp:` 메시지가 열린 해당 세션에 사용자 입력 없이 도착한다.
  - [ ] `@all:`이나 다른 피어 앞 메시지는 전달되지 않는다.
  - [ ] 한 메시지는 한 번만 전달된다.
  - [ ] 두 에이전트가 확인 답장만 주고받으며 서로를 계속 깨우지 않는다(규칙: 요청이 있을 때만 답장).

## Non-functional requirements

| Item | Criterion |
| --- | --- |
| Supported environments | Windows 10, 이 PC 로컬만. Node 24, uv/uvx 사용 |
| Performance | omp 알림 지연 10초 이내 |
| Accessibility | N/A (터미널 텍스트) |
