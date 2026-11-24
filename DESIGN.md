# agents-bus — Design system

[← Hub](.workflow/README.md) · Prev: [3. UX flowchart](.workflow/03-flow.md) · Next: [6. Mid-fi wireframe](.workflow/06-wireframe/index.html)

Created: 2026-11-19

<!-- wf:design
status: done
-->

> The single source of truth for UI. Read it before any UI work or UI fix. Add a token or component here before using it.
> Source: visual direction from omp / Claude Code terminal output (lite mode, no stage 4).
> Done when: tokens and core components are defined and the user approved → `status: done`. It keeps changing after that; log every change.

## At a glance

- UI는 터미널 텍스트뿐이다. 토큰은 ANSI 색 이름, ASCII 기호, 줄 형식이다. 웹용 폰트·반경·그림자는 해당 없음.
- 강조는 청록 `[bus]` 접두어와 굵은 발신자 이름 하나. 메시지 사이에 빈 줄을 둔다.
- 색이 없는 터미널에서도 `[bus]` 접두어와 굵기만으로 같은 정보가 읽힌다.

## Principles

- 색은 정보를 더하지 않는다. 색을 빼도 의미가 같다 (기호와 단어가 먼저).
- 모든 출력은 ASCII만 쓴다. Windows 터미널 인코딩 문제를 피한다.
- 알림은 한 줄, 내용은 `/bus`에서 본다. 알림에 메시지 본문을 싣지 않는다. 예외: 자기 앞(`@<peer>:`)으로 온 메시지는 세션에 전달하는 WakeMessage로 본문을 싣는다 (F-08).
- 호스트 CLI(omp)의 기본 스타일을 거스르지 않는다.

## Tokens

Code uses these names, never raw values.

### Color

ANSI 16색 이름만 쓴다. 터미널 테마가 실제 값을 정한다. 대비는 테마가 책임진다.

| Token | Value | Use |
| --- | --- | --- |
| color.bg | (터미널 기본) | 배경, 지정하지 않음 |
| color.surface | (없음) | 박스·패널을 쓰지 않는다 |
| color.text | 기본 전경색 | 본문 |
| color.text-muted | dim (SGR 2) | 시간, 토픽 |
| color.primary | cyan | `[bus]` 접두어 |
| color.on-primary | (해당 없음) | |
| color.border | (없음) | 선을 긋지 않고 빈 줄로 구분 |
| color.danger | red | `[err]` |
| color.success | green | `[ok]` |
| color.warn | yellow | `[skip]` |

### Typography

| Token | Size / line-height / weight | Use |
| --- | --- | --- |
| font.family | 터미널 고정폭 (지정하지 않음) | |
| text.title | bold | 발신자 이름, 섹션 제목 |
| text.body | normal | 메시지 본문 |
| text.caption | dim | 시간, 토픽, 힌트 |

### Spacing · radius · shadow · motion

| Token | Value |
| --- | --- |
| space.1 | 공백 2칸 (들여쓰기) |
| space.2 | 빈 줄 1개 (메시지 사이) |
| line.max | 100열에서 줄바꿈 |
| radius / shadow / motion / breakpoint | 해당 없음 |

## Components

| Component | Purpose | Variants | States | Tokens | Screens |
| --- | --- | --- | --- | --- | --- |
| StatusLine | 설치 결과 한 줄 `[ok] claude  registered` | ok / skip / err | - | color.success, color.warn, color.danger, text.body | install |
| BusNotice | omp 새 메시지 알림 한 줄 `[bus] 2 new from codex, agy` | 1건 / 여러 건 / 다른 피어 앞 `[bus] 1 new for agy.X from codex  try: ask agy.X to check the bus` / 상태줄 `[bus] omp.리팩터링  1 new  agy: 2` (이름 있는 세션만 자기 주소 표시) | DB 없음(표시 안 함) | color.primary, text.title | notify |
| MessageBlock | 메시지 하나. 헤더 `from -> to  topic  time` + 들여쓴 본문 | 일반 / 답장 | 빈 인박스는 `no new messages` | text.title, text.caption, text.body, space.2 | inbox |
| Hint | 다음 행동 한 줄 `try: /bus` | - | - | text.caption | install, notify, inbox |
| WakeMessage | 자기 앞 메시지를 세션에 전달. 헤더 `[bus] codex -> omp.리팩터링  hr-sync  13:22`(받는 쪽은 세션 주소) + 들여쓴 본문 + 빈 줄 + 답하는 방법 두 줄 | omp 세션 메시지 / Codex queue 텍스트(시각 없음) | 긴 본문은 잘라 `(truncated; sync returns the full text)` | color.primary, text.title, text.body, space.1, space.2 | wake |

## Patterns

- Layout grid: 단일 열, 왼쪽 정렬, 본문은 `space.1`로 들여쓴다.
- Empty / loading / error states: 빈 상태 `no new messages`. 로딩 표시 없음(즉시 응답). 오류는 `[err]` + 원인 한 줄 + 해결 힌트 한 줄.
- Forms: 없음. 입력은 CLI 인자와 슬래시 명령뿐이다.

## Avoid

AI-slop defaults this product is most likely to fall into (from the anti-slop checklist):

- 이모지·유니코드 장식 아이콘(`✓`, `🚀`)으로 상태를 표시하는 것
- 박스 드로잉 문자로 패널·카드 테두리를 그리는 것
- 알림마다 배너·구분선을 넣어 한 줄을 여러 줄로 부풀리는 것
- 색 하나에 의미를 전부 맡기는 것

### Deliberate exceptions

| Pattern | Why it fits this product |
| --- | --- |
| 터미널 고정폭 글꼴 | 호스트가 정하는 터미널 텍스트가 UI 전부라서 선택 여지가 없다 |

## Change log

| Date | Change | Why |
| --- | --- | --- |
| 2026-11-19 | created | - |
| 2026-11-19 | 토큰을 ANSI 이름·ASCII 기호로 정의 | UI가 터미널 텍스트뿐 |
| 2026-11-24 | WakeMessage 추가, "알림에 본문 없음" 원칙에 F-08 예외 | 사용자가 Claude channels처럼 열린 세션이 메시지를 바로 받기를 요청 |
| 2026-11-24 | BusNotice에 "다른 피어 앞" 변형, 상태줄 `[bus] 1 new  agy: 2` | agy는 자동 전달이 안 되므로(약관) omp 화면에서 사용자에게 알림 |
| 2026-11-24 | 피어 이름에 세션 이름(`omp.리팩터링`), 상태줄에 자기 주소, 알림·헤더에 세션 주소 | 같은 CLI를 여러 개 띄우면 서로 메시지가 섞여(커서 공유, 엉뚱한 세션이 깨어남) 세션을 지정해야 함 |
