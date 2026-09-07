# Runtime contract

Studio가 배포한 `FlowSpec 2.0`을 Twilio/OpenAI 런타임에서 실행하기 위한 계약입니다. JSON Schema는 [`contracts/flow.schema.json`](../contracts/flow.schema.json)에 있습니다.

## 미디어 경로와 실행 단위

```text
고객 ↔ Twilio ↔ Media Streams WebSocket ↔ Runtime Gateway ↔ OpenAI Realtime
```

- 입력·출력은 Twilio와 바로 교환할 수 있는 `audio/pcmu`를 사용합니다.
- Studio는 여러 Workspace를 관리하며 각 Workspace는 독립적인 Settings, Agent, Tool, Data, Call Record를 가집니다. Workspace는 여러 Agent를 가질 수 있으며, 각 Agent는 독립적인 Flow Draft와 배포 버전을 관리합니다.
- 통화마다 하나의 Realtime 세션과 선택한 Agent의 배포된 불변 FlowVersion을 종료까지 유지합니다.
- Studio는 현재 단일 배포 구성을 사용합니다. Settings에서 Telephony Integration과 `PUBLIC_URL`, Twilio 인증값, OpenAI Endpoint/API Key를 관리합니다. `PUBLIC_URL`은 ngrok, 클라우드 배포 주소 등 Twilio가 접근할 수 있는 HTTPS Base URL입니다. 프로토타입에서 Token/API Key는 현재 탭 세션에만 유지하며, 실제 서버 통합 시 Secret Manager에 저장합니다.
- 현재 Telephony Integration은 Twilio Media Streams만 지원하며 SIP는 향후 연결 방식으로 표시합니다.
- Draft 변경은 진행 중인 통화에 영향을 주지 않습니다.

## 블록 실행 의미

### Start

Start는 정확히 하나이며 `entry_node_id`와 일치해야 합니다. `start.session_update`는 최초 OpenAI `session.update`의 `session` 본문으로 사용할 수 있는 형태입니다. 모델, 음성, 속도, PCMU, 전사, VAD, 공통 지침을 이곳에서 설정합니다. OpenAI Endpoint와 API Key는 FlowSpec에 포함하지 않고 Runtime이 Settings 값을 주입합니다.

Start의 `create_response`는 항상 `false`입니다. 각 Node가 수동·자동·응답 없음 방식을 개별적으로 결정합니다. `initial_input_gate_ms` 동안 사용자 입력 처리를 보류해 세션 설정과 첫 안내가 경합하지 않도록 합니다.

### Node

Node 진입 시 Runtime은 공통 지침과 Node 지침을 합성하고 허용 Tool 및 실행 설정을 적용합니다.

| `response_mode` | 실행 방식                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `manual`        | VAD가 오디오를 commit하면 서버가 현재 Node의 instructions/tools로 `response.create`를 보냅니다.            |
| `automatic`     | Node 설정을 `session.update`하고 `session.updated`를 확인한 뒤 `create_response:true`로 입력을 허용합니다. |
| `none`          | 모델 응답 없이 저장된 상태와 Edge 조건만 평가합니다.                                                       |

자동/수동 전환은 다음 barrier를 지켜야 합니다.

```text
Node 전환 결정
  → 이전 response/tool 처리 완료
  → session.update(instructions, tools, turn_detection.create_response)
  → session.updated 확인
  → 새 Node 입력 허용
```

이 barrier 없이 `automatic`으로 전환하면 이전 Node 지침으로 VAD 응답이 먼저 시작될 수 있습니다.

### 정보 수집의 2단계 응답

선별검사와 동의 확인은 아래처럼 모델의 구조화 판단을 사용자에게 재생하지 않습니다.

```text
사용자 발화 commit
  → response.create(tool_choice:required, output_modalities:[text])
  → Tool 관찰값 검증·저장
  → 서버의 점수/정책/Edge 평가
  → response.create(tool_choice:none, output_modalities:[audio])
```

Studio에서는 하나의 Node에서 `output_modalities:[text]`, `tool_choice:required`, `parallel_tool_calls:false`, `follow_up_audio:true` 조합으로 표현합니다. `tool_choice:required`는 하나 이상의 Tool 호출을 허용하므로, 한 턴에 하나의 관찰만 처리해야 하는 Node는 `parallel_tool_calls:false`를 사용합니다. Tool은 단계 이동 명령이 아니라 동의·검사 응답·안전 신호 같은 관찰값만 반환합니다.

Node의 역할은 별도 mode나 프리셋 없이 `response_mode`, `output_modalities`, `tool_choice`, `follow_up_audio`, Edge 설정의 조합으로만 결정합니다.

### Edge

Edge는 Runtime이 결정론적으로 평가합니다.

- `always`: 조건 없이 이동
- `condition`: `all`(AND) 또는 `any`(OR)로 State 비교와 Timeout 규칙을 함께 평가
- `fallback`: 같은 출발 Node의 어떤 조건도 맞지 않을 때 이동

Edge 우선순위는 Builder가 내부적으로 관리하며 UI에서 직접 입력하지 않습니다. 일치하는 Edge가 없으면 현재 Node에 머무르며 다음 응답을 기다립니다. 장기 무응답 종료는 VAD의 `silence_duration_ms`를 크게 잡는 방식이 아니라 Condition 안의 `timeout` 규칙으로 모델링합니다. 같은 목적지로 이동하는 State 조건과 Timeout은 `any`(OR)로 묶을 수 있으며, Fallback은 다른 규칙과 섞지 않는 독립 Edge입니다.

### Tool, Function, State

Tools 페이지는 GPT Realtime에 전달할 함수 이름, 설명, 파라미터 JSON Schema만 정의합니다. Tool 호출 자체는 실행 결과가 아니라 모델이 서버에 전달한 구조화된 요청입니다.

- `Tool`: 모델에 노출되는 함수 계약
- `Function`: Tool 호출을 실제 API 또는 검토된 서버 코드와 State 업데이트에 연결할 실행 계층
- `State`: 동의 결과, 현재 검사 문항, 점수, 안전 우선순위처럼 통화 중 유지할 서비스 상태

Tool의 Enum 값과 Description 같은 텍스트 입력에는 `@Data.path` 참조를 사용할 수 있습니다. `@` 입력 시 현재 Workspace의 JSON Data 경로를 검색·선택하는 공통 autocomplete가 열립니다. Enum 참조는 표시 이름 대신 `dataId + path`를 저장하고, 배포 시 JSON Data의 실제 문자열 또는 숫자 값으로 해석해 Realtime Tool Schema를 생성합니다. 같은 입력 패턴과 참조 모델은 향후 Function과 State 입력에도 재사용합니다.

Builder는 임의 Python 코드를 직접 실행하지 않습니다. 실행 계층을 연결할 때 부작용이 있는 Function은 `call_id + tool_call_id`를 idempotency key로 사용하고 timeout/retry 정책을 적용해야 합니다.

Node의 Tool 섹션에서 선택한 Tool마다 실행할 Function을 하나 지정하고, Function input별 값을 명시적으로 매핑합니다. 새 Function을 선택할 때 이름이 같은 Tool argument는 편의상 초기값으로 제안할 뿐 이후 자유롭게 수정할 수 있습니다. 값에는 `@tool.arguments.*`, `@state.*`, `@Data.*` 참조 또는 literal을 사용할 수 있습니다. Runtime은 Tool 호출을 받은 뒤 Function과 State 업데이트가 모두 완료된 후에만 해당 Node의 Edge를 평가합니다.

### End

End는 마지막 Audio 응답이 생성되었다는 사실만으로 즉시 통화를 끊지 않습니다.

1. Twilio로 마지막 media 뒤에 mark를 전송합니다.
2. mark acknowledgement를 기다립니다.
3. `playback_timeout_ms` 내 ack가 없을 때만 `fallback_grace_ms` 후 종료합니다.
4. Transcript를 고정하고 Research Agent 작업을 enqueue합니다.

이 방식은 정상 경로에서 문장 끝이 잘리는 것을 막으면서, 네트워크 이상 시 통화가 무기한 남는 것도 방지합니다.

## Prompt 합성 순서

1. 조직이 잠근 공통 안전 규칙
2. Start의 공통 역할과 지침
3. 현재 Node의 목표와 instructions
4. 현재 CallContext에서 필요한 값
5. 해당 응답에만 필요한 문항·선택지·임시 지시

## 배포와 관측

- 배포 시 Schema와 그래프 검증을 모두 통과한 FlowVersion을 새로 생성합니다.
- Deployment는 현재 배포된 하나의 FlowVersion을 가리킵니다.
- 모든 `response.create`, Tool, Edge, mark 이벤트에는 `call_id`, `deployment_id`, `flow_version`, `node_id`, `input_item_id`를 기록합니다.
- Studio Timeline은 동일한 이벤트 스키마를 읽어 단계별 latency, Tool 결과, 선택된 Edge, 종료 사유를 표시합니다.
