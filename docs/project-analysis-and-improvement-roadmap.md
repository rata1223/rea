# REA (Reverse Engineer Anything) 프로젝트 구조·작동원리 분석 및 개선 로드맵

> **문서 대상**: AI 에이전트 및 핵심 개발자
> **문서 목적**: REA 코드베이스의 아키텍처 및 런타임 작동 메커니즘을 상세히 규명하고, 현재 식별된 구조적 허점과 약점을 기반으로 실행 가능한 우선순위별 개선 로드맵을 제공함.

---

## 1. 프로젝트 개요 및 핵심 설계 원칙

REA는 바이너리 분석, 웹/브라우저 런타임, JavaScript/Electron, Android APK, .NET, 펌웨어, EVM 바이트코드, 패킷 캡처 등 다양한 대상의 역공학을 단일 CLI 및 MCP(Model Context Protocol) 인터페이스로 통합 제공하는 고도화된 역공학 프레임워크입니다.

### 1.1 핵심 설계 철학

1. **증거 기반 출처 보존 (Evidence Provenance)**
   - 사실(Observation), 유도된 결과(Derivation), 추론(Inference), 불확실한 상태(Unknown)를 명확히 분리합니다.
   - 분석 결과는 가공된 요약뿐만 아니라 원본 증거(다이제스트, 바이트 오프셋, 심볼 등)를 유지하여 호출자가 검증할 수 있도록 설계되었습니다.
2. **단방향 의존성 흐름 (Inward Dependency Flow)**
   - `Domain` (순수 도메인 로직, 부수효과 없음)
   - `Contracts` (호출자에게 노출되는 Zod 스키마 및 직렬화 정의)
   - `Process & Windows Foundation` (프로세스 그룹 감독, 자격 증명, 격리 런타임)
   - `Provider Adapters` (Ghidra, Hopper, IDA, JADX, Playwright, WABT, EVMole 등 외부 엔진 바인딩)
   - `Application Layer` (세션 라우팅, 워크플로 조합, 증거 원장)
   - `Entrypoints & Adapters` (CLI, MCP Server, Dispatcher)
3. **Fail-Closed & 안전한 실행 권한 격리**
   - 권한 없는 대상 실행/변조를 엄격히 금지하며, 분석용 임시 DB(예: Ghidra ephemeral DB)만을 사용하여 타깃 바이너리 손상을 방지합니다.
   - 프로세스 트리 추적 및 Token 기반 소유권 검증(`src/process/ProcessOwnership.ts`)을 통해 비정상적인 외부 프로세스 간섭이나 자원 누수를 차단합니다.

---

## 2. 프로젝트 세부 구조 및 컴포넌트별 작동 원리

### 2.1 진입점 및 실행 디스패치 (`scripts/rea.mjs`)

- 실행 인자(`process.argv`)에 따라 모드를 결정합니다:
  - `rea mcp` 또는 `--mcp`: `dist/mcp/main.js`를 통해 MCP 표준 입출력(stdio) 서버 구동.
  - `rea mcp doctor`: `dist/cli-runtime/mcpDoctor.js`를 구동하여 환경 및 프로바이더 준비 상태 검사.
  - 일반 CLI 서브커맨드: `dist/cli-runtime/cli.js`를 구동하여 일회성(one-shot) 워크플로 실행.
- 런타임 번들 부재 시 즉시 진단 메시지를 반환하며, 플랫폼별 사전 설정(예: Windows `USERPROFILE` 폴백, Termux Android Chromium 경로)을 진입 전에 선제 적용합니다.

### 2.2 MCP 서버 및 툴 등록 계층 (`src/server/`, `src/contracts/`)

- MCP SDK(`@modelcontextprotocol/server`)를 래핑한 `EvidenceMcpServer`를 중심으로 동작합니다.
- 각 역공학 도메인은 독립된 등록 함수(`registerNativeTools`, `registerAndroidTools`, `registerBrowserTools` 등)를 통해 MCP 툴 카탈로그에 등록됩니다.
- 입력값은 Zod 스키마(`src/contracts/`)를 통해 엄격히 검증되며, 반환값은 구조화된 JSON 및 텍스트 증거(`toolResult.ts`)로 인코딩됩니다.

### 2.3 세션 및 수퍼비전 계층 (`src/application/`, `src/process/`)

- `SessionProviderRouter` / `BinarySession`: 타깃 바이너리당 1개의 불변 심층 분석 프로바이더를 바인딩하고, 보조(Auxiliary) 분석은 분리된 경로로 라우팅합니다.
- `ProcessOwnership`: PID 재사용 및 고아 프로세스 문제를 방지하기 위해 생성 토큰(`DarwinProcessRunTokenReader` 또는 Windows Job Object)을 활용하여 수명 주기를 제어합니다.
- 리소스 한계 제어: Linux의 `prlimit`(`LinuxResourceLimits.ts`)와 Node 워커 메모리 제한(`JavaScriptWorkerMemoryLimit.ts`)을 적용하여 DoS성 바이너리 파싱을 방지합니다.

### 2.4 프로바이더 어댑터 계층 (`src/<engine>/`, `bridge/`)

- **Ghidra (`src/ghidra/`, `bridge/ghidra/`)**: Headless 분석 스크립트(`ReaGhidraBridge.java`)를 통해 임시 프로젝트를 생성하고 분석 후 즉시 정리.
- **Hopper (`src/hopper/`, `bridge/hopper_bridge.py`)**: 백그라운드 프로세스로 런칭 후 Unix 도메인 소켓을 통해 명령을 전달하고 결과를 JSON 스트림으로 수신.
- **IDA (`src/ida/`)**: 외부 `ida-pro-mcp`를 통한 프록시 또는 헤드리스 DB 수퍼비전.
- **Android / JADX (`src/android/`, `bridge/android/`)**: JADX 엔진 프로세스를 격리 실행하여 디컴파일 결과 수집.
- **Web / Browser (`src/browser/`)**: Chrome DevTools Protocol(CDP) 및 Playwright를 기반으로 스크립트, 네트워크, DOM 상태 캡처.

---

## 3. 프로젝트의 구조적 허점 및 약점 분석 (Weaknesses & Bottlenecks)

현재 아키텍처는 고도로 정밀하지만, 실무 환경 및 AI 에이전트 연동 관점에서 다음과 같은 취약점과 병목이 존재합니다.

### 3.1 [허점 1] AI 에이전트 토큰 및 컨텍스트 과다 소비 (Context Bloat)

- **현상**:
  - MCP 툴의 개수가 방대(수십 개 이상)하여, 에이전트가 초기 툴 정의(Tool Schemas)를 로드할 때만 수천~수만 토큰의 컨텍스트를 소모함.
  - `inspect_disassembly`, `decompile_function`, `trace_evidence` 등의 결과가 매우 상세한 JSON AST와 메타데이터를 포함하여 반환되어, LLM의 컨텍스트 윈도우를 급격히 잠식함.
- **위험성**: 컨텍스트 절단(Truncation), 지연 시간 증가, LLM의 추론 정확도 저하.

### 3.2 [허점 2] 프로바이더별 플랫폼 파편화 및 비대칭적 기능 제약 (Platform Disparities)

- **현상**:
  - Hopper는 macOS 및 일부 Linux 지원에 특화되어 있고, Windows에서는 Ghidra P0(`docs/windows-ghidra-p0.md`)만 제한적으로 지원됨.
  - Linux 전용 기능(`pwntools`, `sigrok-cli`, `prlimit` 격리)이 Windows/macOS에서는 비활성화되거나 우회 경로가 부족함.
- **위험성**: 에이전트가 호스트 환경을 온전히 인지하지 못할 경우, 지원되지 않는 프로바이더나 툴을 호출하여 반복 실패(Retry loop)에 빠질 위험이 있음.

### 3.3 [허점 3] 대규모 바이너리/프로세스 수퍼비전 시의 타임아웃 및 메모리 압박 (Supervision Fragility)

- **현상**:
  - Ghidra/Hopper의 초기 인덱싱 시간(`REA_GHIDRA_STARTUP_TIMEOUT_MS`)이 대형 바이너리(예: 수십 MB 이상의 GUI 바이너리) 분석 시 타임아웃을 유발할 수 있음.
  - 긴 세션 유지 시 프로세스 소유권 검증 및 임시 디렉터리(`PrivateRuntimeRoot`) 정리가 예외 발생 시 누수될 잠재적 위험이 존재함.
- **위험성**: 에이전트 호출이 멈추거나(Hang), 호스트 머신의 가용 디스크 및 메모리가 고갈됨.

### 3.4 [허점 4] 에러 복구 및 가이드 메시지의 기계 가독성 한계 (Error Actionability)

- **현상**:
  - 실패 시 태그된 에러 구조체(`src/contracts/errorSchemas.ts`)를 반환하지만, 에이전트가 "그 다음에 취해야 할 조치(Next Action / Alternative Provider)"를 직접 유추해야 함.
- **위험성**: 에이전트가 원인을 이해하지 못하고 동일한 실패 호출을 반복하거나 조기 포기함.

---

## 4. 능동적 개선 목표 및 우선순위 로드맵 (Actionable Roadmap)

개선 과제는 영향도(Impact), 구현 복잡도(Complexity), 그리고 시급성에 따라 **P0 (Critical) ~ P3 (Low)** 로 분류합니다.

| 우선순위 | 과제명                                                                        | 대상 영역                                      | 기대 효과                                             |
| :------- | :---------------------------------------------------------------------------- | :--------------------------------------------- | :---------------------------------------------------- |
| **P0**   | **에이전트 맞춤형 토큰 압축 및 적응형 상세도(Detail Level) 도입**             | `src/server/`, `src/contracts/`                | LLM 컨텍스트 소비 50~70% 절감, 지연 감소              |
| **P0**   | **실행 실패 시 능동적 자가 치유 가이드(Actionable Error Handoff) 제공**       | `src/contracts/errorSchemas.ts`, `src/server/` | 에이전트의 재시도 루프 방지 및 대체 경로 자동 선택    |
| **P1**   | **플랫폼별 기능 사전 마스킹 및 호스트 환경 자가 진단 강화**                   | `src/server/mcpClientMetadata.ts`, `src/cli/`  | 미지원 플랫폼 도구 호출 차단 및 실행 전 실패 방지     |
| **P1**   | **대규모 바이너리 비동기 청크 스트리밍 및 점진적 분석(Progressive Analysis)** | `src/application/`, `src/process/`             | 타임아웃 완화 및 메모리 사용량 상한(Bound) 안정화     |
| **P2**   | **외부 프로바이더 의존성 격리 컨테이너/샌드박스 프로파일 표준화**             | `src/process/`, `scripts/`                     | BYO 도구 설치 및 버전 충돌 해결                       |
| **P3**   | **바이너리 간 유사도 비교 및 재구성 자동화 워크플로 템플릿 확충**             | `src/application/investigation/`               | 리버스 엔지니어링 후 재구현(Reconstruction) 속도 가속 |

---

## 5. 상세 개선 구현 방안 (Detailed Action Plans)

### 5.1 [P0] 에이전트 맞춤형 적응형 응답 및 토큰 최적화

- **문제점**: 역공학 결과의 방대한 AST 및 제어 흐름 그래프가 LLM 토큰을 과도하게 소모.
- **구현 방안**:
  1. 모든 분석 툴의 요청 파라미터에 `summary_only: boolean` 및 `max_tokens_budget?: number` 필드 추가.
  2. `toolResult.ts` 단계에서 디컴파일 결과가 예산을 초과할 경우, 핵심 함수 시그니처와 호출 그래프 요약(Digest)만 반환하고, 세부 오프셋은 온디맨드 쿼리(`inspect_function_offset`)로 유도.
  3. 반복되는 메타데이터는 참조 키(Reference ID) 기반으로 캐싱하여 반환 크기를 최소화.

### 5.2 [P0] 에이전트 자가 치유형 에러 스키마 (Actionable Error Response)

- **문제점**: 도구 실행 실패 시 에러 코드만 반환되어 에이전트가 대안을 찾지 못함.
- **구현 방안**:
  1. `errorSchemas.ts`에 `suggested_recovery`:
     ```json
     {
       "error": "PROVIDER_TIMEOUT",
       "reason": "Ghidra headless analysis exceeded 120s deadline.",
       "actionable_suggestions": [
         {
           "action": "increase_timeout",
           "env": "REA_GHIDRA_STARTUP_TIMEOUT_MS=300000"
         },
         {
           "action": "fallback_provider",
           "provider": "hopper",
           "available": true
         },
         { "action": "narrow_scope", "parameter": "analyze_entrypoint_only" }
       ]
     }
     ```
  2. 에이전트가 별도의 추론 없이 즉각적으로 대안 툴이나 매개변수를 교정할 수 있도록 유도.

### 5.3 [P1] 환경 인지형 툴 카탈로그 필터링 (Environment-Aware Tool Pruning)

- **문제점**: Linux 전용 툴(`tshark`, `pwntools`, `sigrok`)이 macOS/Windows 환경에서도 카탈로그에 노출되어 에이전트가 무효한 호출을 시도함.
- **구현 방안**:
  1. 서버 시작 시점(`EvidenceMcpServer.ts`)에 호스트 OS 및 설치된 바이너리를 검사.
  2. 현재 환경에서 실행 불가능한 툴은 MCP 툴 리스트에서 제외하거나 비활성 메타데이터(`disabled: true`, `reason: "Requires Linux x64"`)를 명시.
  3. 에이전트의 탐색 공간을 줄이고 호출 실패율을 0%로 수렴시킴.

### 5.4 [P1] 프로세스 수명 주기 및 임시 아티팩트 청소(Garbage Collection) 가드 강화

- **문제점**: 분석 도중 강제 종료되거나 타임아웃된 경우 임시 파일 및 고아 프로세스 잔존 가능성.
- **구현 방안**:
  1. `ProcessOwnership.ts`의 종료 트랩(SIGINT, SIGTERM, Unhandled Rejection)에 비동기 파이널라이저를 엄격히 보장.
  2. `PrivateRuntimeRoot` 생성 시 고유 RunID를 PID와 매핑하여 파일 시스템에 레코딩하고, 서버 시작 시 이전 세션의 고아 디렉터리를 자동 sweep하는 시작 가드(`StartupSweeper`) 구현.

---

## 6. 결론 및 향후 전망

REA는 현재 바이너리와 애플리케이션 분석 분야에서 가장 완성도 높은 MCP 역공학 도구 중 하나입니다.
본 문서에서 제시한 **P0(토큰 최적화 및 에러 조치 유도)** 과제를 우선적으로 적용한다면, Claude Code, Cursor, Codex 등 최신 AI 에이전트와의 협동 분석 성공률이 비약적으로 향상될 것입니다.
