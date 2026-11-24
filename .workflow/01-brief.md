# agents-bus — Brief

[← Hub](README.md) · Next: [2. Feature spec](02-spec.md)

Created: 2026-11-18

<!-- wf:brief
status: done
-->

> Done when: every section is filled in and the user has confirmed → `status: done`

## At a glance

- 한 PC에서 omp, Claude Code, Codex, Antigravity(agy)가 서로 메시지를 주고받는 로컬 버스. omp가 메인.
- 새 버스를 만들지 않고 기존 오픈소스(우선 agent-bus-mcp)를 채택해, omp 알림 확장과 agy 약관 준수 규칙만 얹는다.
- agy는 사람이 직접 연 대화형 세션으로만 참여한다. 버스가 agy를 실행·래핑하지 않는다.

## 1. One-line definition

한 PC의 여러 코딩 CLI가 서로 소통하는 로컬 메시지 버스를, 기존 도구 위에 omp 중심으로 구성한다.

## 2. Problem

- What is painful today: omp를 메인으로 쓰고 싶은데 Antigravity가 약관 위반(§6, 제3자 도구로 접근)으로 차단되어 omp 안에서 쓸 수 없다. 에이전트 간 결과는 사람이 복사·붙여넣기로 옮긴다.
- How it is solved today: CLI별로 따로 열고 사람이 중계한다.

## 3. Target users

| User type | Situation | What they want |
| --- | --- | --- |
| 본인(1인) | 한 PC에서 터미널 여러 개에 서로 다른 에이전트를 띄워 씀 | omp에서 작업하다가 다른 CLI에 맡기고 결과를 받기. 약관 위반 없이 |

## 4. Reference research

기존에 같은 목적의 도구가 여럿 있다. 직접 읽어 확인한 내용이다.

| Subject | Strengths | Weaknesses | What to borrow |
| --- | --- | --- | --- |
| [agent-bus-mcp](https://github.com/alessandrobologna/agent-bus-mcp) (★7) | MCP stdio + SQLite, 토픽/피어/커서, 재접속, 검색, 웹 UI. `uvx`로 실행 | Windows 문서 없음. 푸시 알림 없음(`sync()` 가져오기) | 1순위 채택 후보 |
| [agmsg](https://github.com/fujibee/agmsg) (★1.6k) | 성숙, Antigravity 포함 6종 지원, 전달 모드 다양 | omp 미지원. Windows는 Git Bash + sqlite3 필요(이 PC는 `bash`가 WSL 셔임, sqlite3 없음). `spawn antigravity`는 약관상 위험 | 전달 모드 개념. 대안 후보 |
| [agent-bus](https://github.com/MustaphaSteph/agent-bus) (★2) | MCP + SQLite, 도구 65개, UI, Claude/Codex 자동 깨우기 | 신생. 깨우기는 Claude/Codex 한정 | 깨우기 방식 참고 |
| [agent-message / SAMP](https://slima4.github.io/agent-message) | 공유 폴더 JSONL, 의존성 최소 | 알림 없음 | 파일 로그 형식 참고 |

공통 빈칸: omp 정식 지원 없음. agy는 푸시 불가(가져오기만).

**Antigravity 약관 근거** (이 프로젝트의 핵심 제약)

- [약관 §6](https://antigravity.google/terms): 제3자 소프트웨어로 접근하면 위반, 계정 정지 사유.
- [FAQ](https://antigravity.google/docs/faq): `agy -p`는 직접 스크립팅/CI 용도. 제3자 에이전트가 `agy`를 감싸는 것은 개인 요금제에서 미지원.
- [Google 직원 답변](https://discuss.ai.google.dev/t/tos-clarification-dsh-antigravity-acp/199574): 로컬 로그인 파일 읽기, `agy` 래핑, 워커 풀은 위험. 대안은 Gemini API 키.

## 5. Target outcome

- omp, claude, codex, agy가 같은 팀에서 서로 메시지를 보내고 받는다.
- omp는 새 메시지가 오면 알림이 뜬다.
- agy는 사용자가 직접 연 세션에서 버스 도구를 호출해 참여한다.

## 6. Success criteria

- 4개 CLI가 이 PC에서 같은 팀에 참여해 서로 송수신에 성공한다.
- 코드와 설정 어디에도 버스가 `agy`를 실행하거나 `agy -p`를 호출하는 경로가 없다.
- omp는 사용자가 묻지 않아도 새 메시지 도착 알림을 표시한다.
- 세션을 종료했다가 다시 열어도 읽지 않은 메시지가 남아 있다.

## 7. Out of scope

- 다른 PC·원격 간 통신 (이 PC 로컬만)
- 버스가 CLI를 대신 실행(spawn)하는 기능
- 인증, 암호화, 다중 사용자
- 새 버스 엔진을 처음부터 구현

## 8. Constraints

- OS: Windows 10. Node 24, uv/uvx 있음. `bash`는 WSL 셔, sqlite3 없음.
- 대상 CLI: omp 18.22.2, Claude Code 2.1.327, Codex 0.166.0, agy, (gemini 0.42 설치됨, 이번 대상 아님)
- 전달 방식: 가져오기(pull) 기본. omp는 확장으로 자동 알림.
- 약관: agy 자격증명 접근·래핑·계정 전환 자동화 금지.

## 9. Assumptions

- agent-bus-mcp가 Windows에서 `uvx`로 동작한다고 가정. 9단계에서 실제 설치해 검증한다.
- omp 확장(`package.json` → `omp.extensions`)으로 새 메시지 감시·알림이 가능하다고 가정.
- agy의 MCP 도구 호출은 "사람이 직접 연 대화형 세션 + Google 공식 클라이언트" 범위로 허용된다고 판단했다. 법적 판단은 아니며, 계정 위험은 사용자가 감수한다.
- 최종 후보 선정은 9단계 기술 설계에서 시험 설치 후 결정한다 (agent-bus-mcp 우선).
