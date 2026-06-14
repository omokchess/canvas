# P2P Collaborative Drawing Board (실시간 협업 그림판)

이 프로젝트는 브라우저에서 서버의 직접적인 중계(Signaling 제외) 없이 WebRTC 기술을 활용해 실시간으로 선(Stroke) 데이터를 상호 교환하고, 동시에 안정적인 드로잉 영구 보존을 위해 Supabase 데이터베이스와 유기적으로 동기화되는 완성형 **P2P 실시간 그림판 웹 애플리케이션**입니다.

## 🌟 주요 핵심 기능

1. **지능형 하이브리드 저장 메커니즘**: 
   - 환경 변수에 Supabase 설정(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 등)이 갖춰진 경우 Supabase 클라우드에 실시간 선 데이터를 자동 보존합니다.
   - 키가 누락되었거나 테이블이 생성되지 않은 경우에도 데모/테스트에 용이하도록 자동으로 **In-Memory 세션 연동 모드**로 전환되어 즉각적인 드로잉 공유를 보장합니다.
2. **WebRTC PeerJS 기반 초저지연 동기화**:
   - 중앙 API 서버 부하 없이 참여 중인 피어(Peer) 전체에 동시 메시지 브로드캐스트를 수행합니다.
   - 데이터베이스 기반 피어 발견(Roster Discovery) 방식을 사용하여 별도의 복잡한 시그널링 채널 수동 등록 없이 룸에 소속된 참여자들을 자동으로 물어오고 메쉬망을 만듭니다.
3. **고정 가상 해상도 (1920x1080) 정규화**:
   - 접속한 기기의 화면 해상도가 제각기 달라도 비율 왜곡 없이 정확한 캔버스 위치에 선이 그려지도록 좌표계를 정규화 및 역투영(Projection) 연산합니다.
   - `DevicePixelRatio`를 반영하여 고해상도 모니터에서도 번짐이나 희미해짐 현상 없이 선명하고 또렷하게 드로잉 브러시를 재생합니다.
4. **로컬 오프라인 보호 및 재시도 대기열 (Retry Queue)**:
   - 일시적인 네트워크 순단이나 Supabase 쓰기 지연 발생 시, 드로잉이 중단되지 않고 대기열(Queued buffer)로 누적되어 주기적으로 재시도 저장 작업을 전개합니다.
5. **풍부한 드로잉 툴킷**:
   - 펜(색상 프리셋 및 커스텀 Picker 제공), 지우개, 되돌리기(Undo), 다시 실행(Redo), 전체 지우기(Soft and Hard clean sync), 보관용 고화질 PNG 이미지 로컬 다운로드 기능을 전사적으로 제공합니다.

---

## 📂 폴더 구조 (Folder Structure)

```text
p2p-drawing-board/
├─ package.json             # NPM 패키지 및 Express + Vite 빌드 스크립트 설정
├─ metadata.json            # AI Studio Applet 메타데이터 정의
├─ vite.config.ts           # Vite 프론트엔드 HMR 세팅 및 번들러 옵션
├─ tsconfig.json            # TypeScript 정밀 컴파일 옵션
├─ server.ts                # Express 백엔드 API & Vite 미들웨어 통합 서버 엔트리
├─ .env.example             # 환경변수 가이드 구성 문서
├─ README.md                # 종합 개발자 문서 및 트러블슈팅 매뉴얼
├─ sql/
│  └─ schema.sql            # Supabase 테이블 및 RLS 보안 규칙 세팅 SQL
└─ src/
   ├─ main.tsx              # React 마운트 진입점
   ├─ App.tsx               # 로비(Lobby)와 그림판(Board) 상태기반 라우터
   ├─ index.css             # 글로벌 폰트(Space Grotesk, Inter, JetBrains) 설정 및 Tailwind 매핑
   ├─ types.ts              # 비즈니스 데이터 타입 정의 (Stroke, Message, Point 등)
   └─ components/
      ├─ Lobby.tsx          # 시작 닉네임 입력 및 룸 생성/참가 게이트웨이 컴포넌트
      └─ Board.tsx          # 핵심 드로잉 및 WebRTC, Supabase 동기화 통제 보드
```

---

## 💾 Supabase 데이터베이스 설정 방법

1. **Supabase 프로젝트 생성**:
   - [Supabase Console](https://supabase.com/)에 로그인하고 새로운 프로젝트를 생성합니다.
2. **SQL 스키마 적용**:
   - 프로젝트 대시보드 내부의 **SQL Editor** 메뉴로 이동합니다.
   - `New Query`를 만든 후, 이 단락 하단이나 `/sql/schema.sql` 소스 파일에 작성된 SQL 코드를 전체 복사하여 붙여넣고 **Run (Ctrl + Enter)** 버튼을 눌러 테이블과 인덱스를 완전 구성해 줍니다.

### SQL Schema 소스 코드 (`/sql/schema.sql`)
```sql
-- 1. 방 정보 테이블 생성
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  title text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_rooms_room_code on rooms(room_code);

-- 2. 드로잉 영구 선(Stroke) 데이터 테이블 생성
create table if not exists strokes (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references rooms(room_code) on delete cascade,
  user_id text not null,
  tool text not null,
  color text not null,
  size integer not null,
  points jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_strokes_room_code_created on strokes(room_code, created_at);

-- 3. 실시간 연결을 위한 피어 상태값 관리 테이블 생성
create table if not exists room_peers (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references rooms(room_code) on delete cascade,
  peer_id text not null,
  nickname text,
  last_seen timestamptz default now(),
  created_at timestamptz default now(),
  unique(room_code, peer_id)
);
create index if not exists idx_room_peers_room_code_seen on room_peers(room_code, last_seen);

-- 4. 행 레벨 보안(RLS) 활성화 설정 (보안 강화 단계)
alter table rooms enable row level security;
alter table strokes enable row level security;
alter table room_peers enable row level security;

-- 5. 개발 편의성 및 프록시 접근을 위한 공용 정책(Public Policies) 등록
create policy "Allow public read rooms" on rooms for select using (true);
create policy "Allow public insert rooms" on rooms for insert with check (true);
create policy "Allow public update rooms" on rooms for update using (true);

create policy "Allow public read strokes" on strokes for select using (true);
create policy "Allow public insert strokes" on strokes for insert with check (true);
create policy "Allow public update strokes" on strokes for update using (true);

create policy "Allow public read peers" on room_peers for select using (true);
create policy "Allow public insert peers" on room_peers for insert with check (true);
create policy "Allow public update peers" on room_peers for update using (true);
create policy "Allow public delete peers" on room_peers for delete using (true);
```

---

## ⚙️ 환경변수 설정 방법 (`.env`)

로컬 디렉토리 루트 경로에 `.env` 파일을 생성하고 아래 내용의 키 세팅을 입력합니다. (클라이언트 단에 보안 키가 직접 유출되지 않도록 전량 서버사이드(`server.ts`) 프록시 처리를 거칩니다.)

```env
# Supabase API 접속 엔드포인트 정보
SUPABASE_URL="https://your-supabase-project.supabase.co"

# Supabase API 인증용 클라이언트 키 (Anon or Service Role)
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your-key-here"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your-service-role-key-here"
```

---

## 🚀 로컬 개발 및 실행 방법

1. **의존성 설치**:
   ```bash
   npm install
   ```
2. **로컬 개발 서버 실행 (Express + Vite 통합)**:
   ```bash
   npm run dev
   ```
   실행 완료 후 터미널에 표시되는 `http://localhost:3000` 주소로 브라우저를 열고 접속합니다.

3. **프로덕션 빌드 및 기동**:
   ```bash
   npm run build
   ```
   이어서 배포 가능한 상태용 실행은 다음 명령을 수반합니다:
   ```bash
   npm start
   ```

---

## ☁️ Vercel 배포 방법

본 프로젝트는 통합 풀스택 Express 아키텍처로 구현되어 있으므로 Vercel Serverless로 간편하게 원클릭 배포할 수 있습니다. 

1. **`vercel.json` 파일 설정**:
   루트 경로에 아래 내용의 `vercel.json` 설정 파일을 배치하면 Vercel의 Serverless Function이 모든 동적 라우팅을 Node.js API로 라우팅해 줍니다.
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "dist/server.cjs",
         "use": "@vercel/node"
       }
     ],
     "routes": [
       {
         "src": "/api/(.*)",
         "dest": "dist/server.cjs"
       },
       {
         "src": "/assets/(.*)",
         "dest": "/dist/assets/$1"
       },
       {
         "src": "/(.*)",
         "dest": "/dist/$1"
       }
     ]
   }
   ```
2. **Vercel CLI 또는 GitHub integration을 통한 배포**:
   - Vercel CLI 이용 시: `vercel --prod` 명령어 입력
   - 프로젝트 세팅 내부의 Environment Variables 목록에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`를 누락 없이 바인딩한 후 빌드를 제출해 줍니다.

---

## 🔗 PeerJS의 실시간 동기화 동작 원리

```text
[ 유저 A 브라우저 ]                           [ 유저 B 브라우저 ]
        │                                             │
        ├────────── 1. PeerJS 등록 시그널링 ─────────┤ (PeerJS 퍼블릭 클라우드 이용)
        │                                             │
        ├─ 2. Supabase DB 조회 ─> [룸 피어 목록 확보] ─┤
        │                                             │
        ├───────── 3. WebRTC Data Channel 커넥션 ─────┼─> [커넥션 승인 및 연결 저장]
        │                                             │
 [ 드로잉 드래그 완료! ]                               │
        │                                             │
        ├─ 4. P2P로 직접 Stroke 데이터 브로드캐스트 ─> [수신 즉시 캔버스에 무손실 드로잉 재생]
        │                                             │
        └─ 5. 백엔드 API 호스트 호출 (Strokes 저장)     │
```

1. **고유 ID 획득**: 방에 접속하면 PeerJS 클라우드가 브라우저의 고유 세션을 식별해 임의 성격의 `PeerId`를 부여합니다.
2. **피어 정보 공유**: 소속된 룸의 피어 목록에 자신을 등록(`POST /api/rooms/:roomCode/peers`)합니다.
3. **메시 체이닝 수립**: DB에서 검색한 다른 피어들의 ID를 전달받아 각각 `peer.connect(pId)` 연결 신호를 송제하여 직접적인 WebRTC Peer-To-Peer 1:1 양방향 가교를 수립합니다.
4. **선 실시간 전송**: 선을 한 번 그릴 때마다 해당 선을 표출하는 정규화된 1920x1080 좌표 배열(`points`) 전체가 직렬화되어 상대 피어의 데이터 핸들러 채널로 고속 전송되므로, 핑 지연 없이 즉각적으로 화면 마운트를 실현합니다.

---

## 🔧 자주 발생하는 오류 및 해결방안 (FAQ)

### Q1. "Database tables do not exist in Supabase yet" 오류가 화면에 나타납니다.
- **원인**: 환경변수는 연동되었으나 Supabase SQL Editor를 통해 필요한 물리 테이블(`rooms`, `strokes`, `room_peers`)과 릴레이션들이 적재되지 않았기 때문에 발생합니다.
- **해결책**: Supabase 프로젝트 내 SQL Editor로 진입하여 `/sql/schema.sql` 스키마 파일을 복사 후 실행하여 테이블을 만들어 주십시오.

### Q2. 로컬이나 로컬 환경에서 모바일 접속 시 P2P 선 교환이 안 됩니다.
- **원인**: WebRTC 기술 특성상 NAT 환경 바깥의 네트워크와 소통하려면 STUN이나 TURN 서버가 개입해야 하거나 혹은 SSL(HTTPS) 인증서 검증이 필요한 구조 차이입니다.
- **해결책**: 보안 제한(Secure Contexts) 요건으로 인해 개발 환경을 공용 주소로 프록시하거나 신뢰할 수 있는 외부 도메인에 SSL(HTTPS)이 동반된 상태로 호스팅 배포(Vercel 등)를 완료하면 무결하게 전송됩니다.

### Q3. 방을 나가거나 브라우저를 닫았는데도 참여자 목록에 여전히 표기됩니다.
- **원인**: 사용자가 정상적인 `Leave` 버튼을 통하지 않고 강제로 탭을 끄는 등의 이탈 발생 시, 종료 메시지 유실로 인해 상태 정리가 일시 지연될 수 있습니다.
- **해결책**: 백엔드와 상호 간에 30초 한도의 Heartbeat 감지 프로세스가 탑재되어 있어, 30초간 활성 패킷 응답이 없으면 정규 쿼리(`GET /api/rooms/:roomCode/peers`) 조회 시 자동 비활성 열외 필터링되도록 설계되어 있습니다. 안심하셔도 됩니다.
