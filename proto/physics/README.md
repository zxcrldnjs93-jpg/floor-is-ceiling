# 무의존 2D 물리 엔진

`engine.js`는 원, 회전하는 상자와 볼록 다각형을 처리하는 무의존 ES 모듈이다. 압축 전 코어는 **23,067바이트**, 기존 API로 함께 불러오는 `browser.js` 포함 시 **31,338바이트**다. 기록·재생을 쓰는 장면은 `replay.js`(3,078바이트)를 별도로 가져온다. 좌표 단위는 CSS px, 시간은 초, 각도는 라디안이다. 오른쪽과 아래쪽이 각각 양의 x축과 y축이다.

## 데모

- [demo-dom.html](demo-dom.html)은 실제 HTML 카드 여섯 장이 떨어져 쌓이는 장면이다. 손잡이를 마우스나 터치로 잡아 던질 수 있고 키보드로 손잡이에 초점을 둔 뒤 Enter나 Space를 눌러 던질 수 있다. 글자는 손잡이 밖에서 선택 가능하며 문서 순서대로 읽힌다. 움직임 줄이기 설정에서는 카드를 정적 그리드로 배치한다.
- [demo-stress.html](demo-stress.html)은 원·상자·삼각형을 합쳐 동적 바디 300개를 Canvas에 그린다. 바디를 끌거나 버튼으로 흩트린다. 움직임 줄이기 설정에서는 초기 배치를 한 번 그린다.
- [demo-room.html](demo-room.html)은 「중력을 뒤집으면」의 단면 방이다. 탭이나 **한 걸음** 버튼으로 슬래브를 치고, 의자를 옆으로 끌고, 매트를 놓고, 중력을 뒤집을 수 있다. 접촉 충격이 아래층 조명과 슬래브 파동을 움직이며 **아래층에서 재생**으로 기록을 듣는 위치의 시점에서 다시 볼 수 있다. 움직임 줄이기 설정은 결과 프레임을 표시한다. 두 월드에 동시에 존재하는 바디는 최대 10개(동적 6개, 고정 4개)다. `room.js`의 장면 입력은 화면과 독립적으로 실행할 수 있다.
- [demo-building-physics.html](demo-building-physics.html)은 지붕·7층·6층·5층·5층 아래의 점선 슬래브가 있는 단면이다. 7층 공을 떨어뜨리고 6층 의자를 밀어 기록을 만든다. 7층 기록을 6층에서 듣고, **중력 뒤집기**로 180°에 도달하면 6층 의자 기록을 7층에서 들을 수 있다. 진행률 슬라이더와 **원래대로 돌리기**가 같은 물리 상태를 구동한다.

데모와 가져오는 모듈을 같은 폴더에 둔다. 기존 로컬 정적 미리보기가 있으면 그 경로로 연다. 서버 없이 파일로 미리보기하는 Chrome에서는 작업 공간의 파일만 여는 임시 프로필로 ES 모듈을 불러올 수 있다.

```sh
google-chrome --user-data-dir="$(mktemp -d)" --allow-file-access-from-files \
  "file://$(pwd)/proto/physics/demo-building-physics.html"
```

## 3층 건물 모듈

`building.js`의 `createBuilding({dt=1/120})`이 하나의 장면을 만든다. `building.step()`은 건물, 듣는 방의 조명, 기록 재생을 같은 고정 스텝으로 구동한다. `width`·`height`는 단면의 논리 크기다. `rooms`는 층 번호 `7, 6, 5`를 키로 하는 Map이다. 각 방의 `top`, `bottom`, `props`, `bodies`를 렌더러에서 사용하고 6층·5층은 `lamp`, `cable`도 읽을 수 있다. `copyBlocks` 두 개는 회전이 시작할 때 풀린다. 풀리기 전과 `resetCopyBlocks()` 뒤에는 낙하 열 검사와 물리 충돌에서 제외한다. 바디 예산은 가구·공 6개, 카피 2개, 수신 연출용 진자 2개의 **동적 10개**와 고정 벽·슬래브 6개다. 진자 월드는 듣는 방의 원래 천장에 매달린 조명을 따로 구동한다.

7층 가구의 최초 중심 x좌표는 공 310, 의자 375, 컵 440px이다. 초기 오른쪽 속도 24px/s를 주면 공은 의자 왼쪽 x≈336.57px에서 잠든다. 7층 컵과 6층 머그는 모두 14×18px이며, 축소 전의 단위 면적당 질량을 유지해 각각 0.168, 약 0.16935 질량 단위다.

### 면 판정과 쿵 지수

`building.slabs`의 ID는 `roof`, `6/7`, `6/5`, `below-5`다. 각 슬래브의 `above`와 `below`에는 건물 좌표계의 두 방 번호가 들어가며, 외부는 `null`이다. `face`는 실제 접촉 순간에 슬래브 면의 바깥쪽 법선과 중력의 내적으로 정한다. 중력에 맞서는 면은 `top`, 중력과 같은 방향인 면은 `bottom`, 옆면이나 중력이 면과 평행한 상태는 `edge`다. `top` 접촉이면 맞은 면의 반대편 방으로 전달한다. 따라서 6층 물체는 바로 섰을 때 `6/5`를 거쳐 5층에, 뒤집힌 상태에서는 `6/7`을 거쳐 7층에 전달한다.

| 구독 API | 이벤트 |
| --- | --- |
| `building.onContact(fn)` | 솔버의 개별 슬래브 접촉 이벤트에 `slab`, `body`, `slabNormal`, 구조상 맞은 `side`, 중력 기준 `face`, `sourceRoom`, `receiverRoom`이 붙는다. `gravity`와 `dt`는 충격을 계산한 스텝의 값이다. |
| `building.onThump(fn)` | 충돌 및 6층 의자 긁힘은 0.25초 단위로 보낸다. 7층 의자 끌기는 놓았을 때 전체 동작의 최대값을 한 건으로 보낸다. `type`은 `impact` 또는 `scrape`다. `slab`은 ID 문자열이고 `bodyId`, `point`, `gravity`, `face`, `index`, `normalImpulse`, `frictionImpulse`, `force`, `start`, `peakTime`, `time`을 포함한다. |
| `building.onReceive(fn)` | 실제로 받는 방이 있는 윗면 충격과 기록 재생을 받는다. `kind`는 `live` 또는 `replay`다. 아랫면·옆면·외부로 열린 면은 받는 방에 전달되지 않는다. |

세 구독 함수는 구독 해제 함수를 반환한다. 접촉이 이어지면 새 묶음을 만들지 않는다. 같은 낙하에서 기존 0.25초 안에 다시 닿으면 같은 묶음에 들어간다. 각 스텝에서 동일 바디·슬래브 쌍의 법선 충격량을 합한 뒤 `dt`로 나누고 창 안에서 가장 큰 값을 고른다. 회전 중 한 묶음 안에서 면 판정이 바뀌면, 전달에는 받는 방이 있었던 스텝에 한해 가장 큰 값을 쓴다. 표준 공은 질량 1, 반지름 14px이며 방 높이의 절반에 중심을 놓고 맨바닥에 떨어뜨린다. 같은 `dt`로 기준 낙하를 계산해 `referenceForce`에 둔다. 기본 단계에서 기준 힘은 58,909.44 질량 단위·px/s²이다.

일반 충격은 기준 힘의 비율을 100배해 0~999의 정수로 표시한다. 높이를 지정한 낙하에서 기준을 넘으면 비율을 제곱한 뒤 100배해 화면 범위를 늘린다. 실제 낙하와 기록의 `force`는 이 표시 보정의 영향을 받지 않는다. 기본 장면에서 7층의 클릭 y를 150.5·144·130·114·91·68·50·26px로 바꾸면 첫 쿵은 **30·43·65·80·100·133·165·200**이다.

의자 긁힘은 스텝마다 마찰 충격량 절댓값을 합해 `dt`로 나눈 뒤 창의 최대값을 고른다. 긁힘 지수는 0~200이며, 수신·기록·재생에는 같은 상한을 적용한다. 예전 기록을 재생할 때도 이 범위로 보낸다. `force`와 `frictionImpulse`에는 실측값을 남긴다. 6층 `nudgeChair`는 수평 속도 변화 162px/s와 각속도 변화 0.35rad/s를 주고 긁힘 창을 시작한다. 기준 힘 800으로 정규화하며, 기본 장면에서는 의자가 약 27.4px 밀리고 첫 긁힘은 141이다. 조명에 전달하는 지지점 외력은 접촉점과 조명 사이 거리로 감쇠하며, 쿵 100에서 최대 진자 각은 방의 x 위치에 따라 약 0.28~0.50rad다.

### 회전, 입력, 기록

`building.setProgress(p)`에 S4 진행률을 0~1로 전달한다. `angleForProgress(p)`는 0.25~0.55에서 0→180°, 0.75~0.95에서 180→360°의 목표각을 반환한다. 실제 렌더링에는 225°/초로 제한된 `building.angle`을 사용한다. 시계 방향 각도에 대한 건물 기준 중력은 `g × (sin(angle), cos(angle))`이다. 진행률을 거꾸로 바꾸면 현재 각도에서 같은 상한으로 되돌아간다.

`building.listening`은 0.55~0.75에서 실제 각도가 180°에 도달했을 때 참이다. `building.canInput`은 0.25 전이나 0.95 이후의 바로 선 정지 상태에서 참이다. 재생 중에는 7층 재생과 동시에 실행할 수 있는 6층 `nudgeChair`만 받으며, 진행 중인 끌기는 `releaseChair`로 마무리할 수 있다. 개별 입력 가능 여부는 `building.canInputFor(type)`으로 읽는다. 차단된 `building.input(command)`는 `false`를 반환한다.

| 입력 | 동작 |
| --- | --- |
| `{type:'dropBall',x?,y?}` | `x,y`는 건물 좌표계의 공 중심(px)이다. 방을 클릭한 위치에서 놓되 천장과 바닥 안에 맞추고, 가구와 겹치면 가장 가까운 빈 낙하 경로를 사용한다. 버튼은 `y`를 생략한다. 방 가운데 높이의 기준 낙하(100)가 된다. |
| `{type:'tap',x?}` | 발뒤꿈치 입력. 공 아래에서 바닥까지 12px인 짧은 낙하를 사용한다. 기본 탭은 43이다. |
| `{type:'nudgeChair'}` | 6층 의자를 옆으로 밀고 긁힘 사건을 기록한다. |
| `{type:'mat',enabled}` | 7층 바닥 가운데에 매트 고정 콜라이더를 추가 또는 제거한다. 매트를 깐 뒤 `building.mat`의 `left`, `right`, `top`, `bottom`을 읽어 배치할 수 있다. |
| `{type:'matDrop',y?}` | 매트 중앙 부근의 빈 경로에 같은 표준 공을 정지 상태로 놓는다. S5 맨바닥 시험 시작 시 y를 고정해 매트 시험에도 다시 쓴다. 기본 y는 가장 크게 울린 공 낙하의 높이이며, 기록이 비어 있으면 방 가운데다. |
| `{type:'grabChair',x}` → `{type:'dragChair',x}` → `{type:'releaseChair'}` | 7층 의자를 수평으로 끈다. 포인터 x는 건물 좌표다. 드래그 중 포인터의 초기 잡은 위치를 유지한다. 취소 시에도 `releaseChair`로 놓는다. |
| `{type:'dragChair',distance}` | 버튼·키보드용 의자 끌기. 120Hz에서 60스텝(0.5초)에 걸쳐 포인터와 같은 제약의 목표를 옮긴다. 78번째 스텝(0.65초)에 놓는다. 목표 거리는 ±80px로 제한한다. |
| `{type:'throwBall',x?,y?,vx,vy}` | 포인터를 놓은 좌표와 속도(px/s)로 공을 던진다. 생략된 좌표는 현재 공 중심이다. 출발 위치가 가구와 겹칠 때 빈 쪽으로 보정한다. 속도 벡터의 방향을 유지하며 크기를 최대 600px/s로 제한한다. |

공 입력은 첫 슬래브 접촉까지 다음 한 건을 대기시킨다. 한도에 도달하면 `canInputFor(type)`과 `input(command)`가 `false`를 반환한다. 첫 접촉 뒤 다음 공을 놓으며, 앞선 기록의 0.25초 집계는 마저 끝낸다. `hasPendingDrop`은 수락했지만 첫 기록이나 취소가 없는 입력이 있는 동안 참이다. 기록의 `actionId`는 입력별 ID이고, `inputTime`은 수락한 물리 시각, `peakTime`은 실제 충격 시각이다.

`building.onInputCancelled(fn)`의 `{action,actionId,inputTime,reason}`으로 수락 건의 취소를 받는다. 회전과 센서 진입 때 미완료 건은 각각 `rotation`, `sensor`로 취소한다. 수직 낙하는 첫 경로에서 바닥을 치지 못하면 한 번 다시 시도하고 `blocked`로 정산한다. 던진 공이 물건 위에 안착하면 `rested`로 끝난다. 취소 건은 충격 기록에 들어가지 않는다.

S1의 끌기와 던지기는 기존 수신·재생 이벤트에 `action:'dragChair'` 또는 `action:'throwBall'`로 들어간다. 의자를 놓으면 끄는 동안의 윗면 마찰 힘 최댓값을 `type:'scrape', label:'드르륵'` 한 건으로 기록한다. `dragDistance`는 바디가 실제로 움직인 수평 누적 거리이며, `dragTargetDistance`는 잡은 위치에서 제약 목표를 움직인 최대 거리다. 마지막 바디 이동 거리는 `building.chairDragDistance`에서 읽는다.

7층 끌기의 기본 140점은 이동 100점과 마찰 40점으로 구성한다. 이동은 55px까지 비례해 반영하되, 실제 이동 거리의 네 배까지만 제약 목표의 이동을 인정한다. 마찰은 최대 힘 800까지 비례한다. 상단 60점은 실제 이동 거리·평균 속도·마찰 힘이 모두 증가할 때만 올라간다. 기본 장면에서 -10px는 49, 버튼 -55px는 140이다. 포인터 목표를 -200px 옮기면 3초 경로는 160, 2초 경로는 200이다. 두 포인터 시험은 목표 도착 뒤 0.15초에 놓았다.

브라우저 포인터 경로는 `input({type:'grabChair',x,timeMs})` → `pushPointerSample(timeMs,x)` → `input({type:'releaseChair',timeMs})`를 쓴다. 시각은 같은 원점의 ms이며, 이벤트를 시간순으로 넘긴다. 엔진은 120Hz에서 네 틱을 앞에 확보하고 각 시각을 고정 틱에 배정한다. 한 틱에 여러 좌표가 들어오면 마지막 좌표를 쓴다. 창이 숨는 등 예정 틱이 지난 좌표는 다음 틱에 적용되므로, 같은 결과를 비교할 때는 같은 초기 상태에서 버퍼 안에 좌표를 공급해야 한다. 중단 시에는 시각 없이 `releaseChair`로 바로 정리한다.

움직임 줄이기에서는 거리 입력을 수락한 뒤 `building.settleChairDrag()`를 호출하면 남은 고정 스텝을 즉시 실행한다. 화면 쪽에서도 매 스텝에 처리할 일이 있으면 `building.settleChairDrag(step)`으로 전달한다. `step`은 호출당 `building.step()`을 한 번 실행해야 한다. 거리 입력을 끝까지 실행하면 `true`, 이미 끝났거나 포인터가 잡고 있으면 `false`를 반환한다. 마찰이 기록되면 `onReceive`에서 수신값을 읽는다.

### S5 매트 비교

`compareMatDrop({y?}={})`은 표준 공을 같은 위치·높이에서 정지 상태로 두 번 떨어뜨려 `{y,bare,padded,reduction}`을 반환한다. `y`는 7층 건물 좌표의 공 중심이며 기본값은 91px이다. `bare`와 `padded`의 `force`는 슬래브의 최대 전달력, `index`는 쿵 지수다. `reduction`은 힘 기준 백분율이다. 높은 낙하에 적용하는 표시 보정은 쌍의 두 지수에 같은 배율을 쓴다. 진자에는 측정한 힘의 선형 비율을 전달한다.

실시간 장면에서는 `building.bestDrop?.y`로 가장 크게 울린 공 낙하의 높이를 읽는다. 높이를 직접 넘겨도 되고 `matDrop`이 그 값을 자동 선택하게 둘 수 있다. `building.onReceive`의 `action:'matDrop'`과 `actionId`로 각각의 첫 이벤트를 읽으면 된다. `mat:true`는 실제로 매트를 거친 접촉이다. 이 시험의 이벤트는 `recording('upper')`에서 제외한다.

기본 매트는 너비 144px, 두께 5px이며, 스프링 강성 10,000과 감쇠 계수 100을 사용한다. 공이 매트 윗면에 도달하는 시각에서 스텝을 나누고, 닿을 수 있는 동안 최대 32분할로 접촉력을 계산한다. 각 분할의 충격량을 그 구간의 시간으로 나눠 최대 전달력을 구한다. 고정 슬래브는 매트 반력을 받아 같은 `6/7`로 전달한다. 120Hz의 중앙 기준 낙하에서 최대 전달력 **58,909.44 → 32,851.34**, **44.23% 감소**, 쿵 **100 → 56**을 측정했다.

| 공 중심 y (px) | 쿵 맨바닥→매트 | 힘 감소율 | 6층 진자 최대각 (rad) |
| ---: | ---: | ---: | ---: |
| 26 (최고) | 200 → 114 | 42.85% | 0.333 → 0.250 |
| 26.5 | 200 → 114 | 42.96% | 0.326 → 0.249 |
| 60 | 148 → 84 | 43.48% | 0.318 → 0.227 |
| 91 (기준) | 100 → 56 | 44.23% | 0.314 → 0.171 |
| 130 | 65 → 33 | 49.79% | 0.204 → 0.096 |
| 144 | 43 → 19 | 57.03% | 0.132 → 0.050 |
| 150.5 (최저) | 30 → 5 | 84.05% | 0.089 → 0.011 |

표의 진자각은 매 낙하를 새 건물에서 시작해 3초간 관찰한 최대값이다. 최저 높이에서 매트 윗면까지의 낙하 거리는 0.5px라 다른 높이보다 감소율이 크다. 사이트의 물리 스텝은 디스플레이 주사율과 별개로 120Hz다.

### 복귀 정착

`building.settleReturnedRooms()`는 바로 선 목표각에 실제로 도달한 상태에서 7·6·5층의 공·의자·컵·화분을 각 층 바닥의 정지 포즈에 놓는다. 스크롤 회전이 0° 또는 360°로 돌아오거나 센서가 바로 선 상태에서 해제될 때 엔진도 자동 적용한다. S5를 시작하기 전이나 결과 포즈를 읽기 직전에 호출할 수 있으며, 회전·센서·미완료 입력 중에는 `false`를 반환한다. 충격 테이프와 `bestDrop`은 보존한다. 카피 페이드는 별도 `resetCopyBlocks()`를 사용한다.

### 기기 중력

`orientationToGravity({beta,gamma},{angle,strength:920})`로 화면 방향을 보정한 벡터를 만든다. `building.setSensorGravity(vec)`는 무대 각도를 유지하고 중력 벡터만 바꾼다. 센서 모드에서는 방 입력이 잠기며, 센서 좌표를 포인터 충격이나 바디 속도로 쓰지 않는다. 브라우저에서 뒤집힘을 확정하면 `setSensorGravity({x:0,y:-920},{listening:true})`를 호출한다. 이후 옵션을 생략한 센서 입력은 중력을 바꾸지 않으며, 듣기 전용 상태에서 의자 기록을 재생할 수 있다. 종료·실패·스크롤 경로 이관 시 `building.clearSensorGravity()`를 호출하면 아래쪽 중력과 진행률 제어가 돌아온다.

180° 듣기 구간에서는 지지면에 닿은 7층 공의 수평 속도와 각속도를 감쇠시켜 솔버의 수면 조건에 도달하게 한다. `building.sleepRoom(id)`와 `building.wakeRoom(id)`로 방의 바디를 직접 잠재우거나 깨울 수 있다. 중력 방향을 다시 바꾸면 7층 바디도 깨어난다. 복귀가 정착한 뒤 `building.resetCopyBlocks()`를 호출하면 카피 블록 두 개의 포즈와 속도를 초기화하고 다시 잠근다. 시각 페이드 중에 호출할 수 있다. 실제 각도가 바로 선 정지 목표에 도달했을 때 `true`를 반환하며, 다른 바디의 포즈와 속도는 그대로다.

`building.recording('upper')`는 7층에서 `6/7`로 전달한 기록을, `building.recording('chair')`는 6층 의자가 `6/5`로 전달한 기록을 JSON에 담을 수 있는 값으로 돌려준다. 각 기록은 최근 96건이다.

- 바로 선 상태에서 `building.replay('upper')`는 7층 기록을 `6/7`의 6층 천장으로 재생한다. 기록이 비어 있으면 실제로 계산한 기준 낙하를 한 번 재생한다.
- 뒤집힌 듣기 상태에서는 `building.replay('chair')`가 의자 기록을 `6/7`의 7층 쪽으로 보낸다. 의자 기록도 먼저 만들어야 한다.
- 두 메서드 호출에 두 번째 인수로 저장한 배열을 줄 수 있다. 첫 이벤트부터 시작해 사건 사이의 무음을 최대 1.2초로 줄이고, 기록한 x좌표·정규화 값·법선 충격량·순서를 보존한다. 재생은 충돌을 다시 일으키지 않고 수신 이벤트와 진자 외력을 발생시킨다. `building.stopReplay()`는 재생을 멈춘다.
- 외부 배열에 유한하지 않은 시각·지수·접촉 x가 있으면 `false`를 반환한다. 이미 진행 중인 재생은 보존한다.

### S4 듣기 설명 뒤 의자 재생

듣기 설명이 표시되면 `building.replayChairCue(chairRecord)`를 호출한다. 뒤집힌 듣기 상태에서 한 사건을 예약하고, 120Hz 물리 스텝을 72번 진행한 뒤(0.6초) `onReceive`에 보낸다. `chairRecord`를 생략하면 6층 의자의 첫 긁힘 기록을 쓴다. 기록이 비어 있으면 같은 스텝으로 기준 밀기를 따로 계산한다. 기준값은 쿵 141이다.

수신 이벤트에는 `kind:'replay'`, `track:'chair'`, `cue:'s4-chair'`, `label:'6층 의자'`, `slab:'6/7'`, `sourceRoom:6`, `receiverRoom:7`이 붙는다. 회전·버튼 경로는 듣기 설명 뒤 0.6초 동안 6층 의자의 실제 바디를 폭의 80% 열로 맞추고 듣는 동안 그 열에 둔다. 앞선 스크럽 속도와 관계없이 실제 의자와 재생의 `point.x`가 이 열에서 만난다. 센서 경로는 재생 순간의 의자 x를 쓴다. `point.y`는 `6/7` 슬래브 중심이며, 지수와 충격량은 원래 기록의 값이다. 파동과 이름표의 가로 비율은 `point.x / building.width`를 함께 사용한다.

회전 중 라이브 접촉은 `onContact`, `onThump`, `onReceive`에서 계속 읽을 수 있다. S4 화면에서는 듣기 설명이 보일 때 `s4-chair` 재생만 파동·표지·반응에 연결한다. 듣기 중단 시 의자 열 고정도 풀린다.

예약했으면 `true`다. 듣기 상태 밖이거나 같은 듣기 구간에서 이미 대기 중 또는 재생했다면 `false`다. 반전 해제·센서 종료에서 예약이 취소되며 다음 듣기 구간에서 다시 호출할 수 있다. 표시 전에 화면을 벗어날 때는 `building.stopReplay()`로 취소할 수 있다. 엔진은 호출 뒤 진행한 물리 스텝으로 시간을 재므로 일시정지와 움직임 줄이기의 화면 표시 시점은 호출부가 정한다.

## 기본 통합

```js
import { World, bindDOM, contain, dragPointer, fixedLoop } from './engine.js';

const scene = document.querySelector('.scene');
const card = scene.querySelector('.card');
const world = new World({ gy: 880 });
const body = world.add({ width: 144, height: 62, x: 90, y: 40 });
const binding = bindDOM(body, card);
const stopWalls = contain(world, scene, () => binding.render(1));
let stopDrag;

const loop = fixedLoop(world, scene, alpha => binding.render(alpha), {
  onReduced(reduced) {
    scene.classList.toggle('still', reduced);
    stopDrag?.();
    stopDrag = reduced ? undefined : dragPointer(world, scene, {
      pick: event => event.target.closest('[data-grip]') ? body : undefined
    });
  }
});

// 장면 등록 해제 시 호출
function destroy() {
  loop.destroy();
  stopDrag?.();
  stopWalls();
  binding.destroy();
}
```

장면을 `position: relative`로 두고 카드의 기본 좌표를 `position: absolute; top: 0; left: 0`으로 둔다. 장면에 패딩이 필요하면 외부 래퍼에 둔다. CSS의 `.still` 상태는 카드의 기본 흐름을 복원하고 인라인 `transform`을 `transform: none !important`로 덮는다. `data-grip`에 `touch-action: none`을 적용하면 손잡이 위 터치가 스크롤에 빼앗기지 않는다. 별도 모션 transform이 필요하면 카드를 감싸는 요소에 물리 바인딩을 적용한다.

## 월드와 강체

| API | 동작 |
| --- | --- |
| `new World({ gx=0, gy=1000, cell=64, iterations=9, sleep=true })` | 중력, 공간 해시 셀 크기, 속도 솔버 반복 수와 수면 사용 여부를 설정한다. 일반적인 동적 바디 너비에 가까운 셀 크기부터 사용한다. |
| `world.add(options)` | 모양으로 `radius`, `width`와 `height`, 또는 `vertices: [{x,y}, …]`를 전달한다. 다각형의 정점은 둘레 순서로 주며 두 방향을 지원한다. 엔진이 로컬 정점을 면적 중심에 맞춰 정렬한다. |
| 바디 옵션 | 기본값은 `x=0, y=0, angle=0, vx=0, vy=0, spin=0, mass=1, friction=0.5, restitution=0.12, damping=0, fixed=false`다. `x,y`는 바디 중심이고 `spin`은 초당 라디안이다. `fixed: true`는 바닥이나 벽 같은 고정 바디를 만든다. |
| `topSpring: {stiffness,damping}` | 고정 바디의 위를 향한 면에 눌림과 감쇠를 적용한다. 강성은 양수, 감쇠는 0 이상이다. |
| `world.step(dt,substeps=1,beforeContact=0)` | 한 틱을 전진시킨다. 필요하면 시작부터 `beforeContact`초를 먼저 진행하고 남은 시간을 `substeps`로 나눈다. 충격 이벤트의 `dt`는 충격을 푼 구간, `tick`은 바깥 틱이다. |
| `world.move(body, x, y, angle=body.angle)` | 순간이동한다. 이전 포즈도 같이 갱신해 보간 중에 긴 이동이 생기는 것을 방지한다. 기존 속도를 유지한다. |
| `world.kick(body, vx, vy, spin=0)` | 동적 바디의 속도를 증가시키고 깨운다. 인수는 속도 변화량이다. |
| `world.wake(body?)`, `world.gravity(gx, gy)` | 지정 바디 또는 전체를 깨우거나 중력을 바꾼다. 중력 변경 시 모든 동적 바디가 깨어난다. |
| `world.sleepBody(body)` | 동적 바디를 현재 포즈에서 잠재우고 속도를 0으로 만든다. 중력 변경과 같은 접촉 그룹의 움직임으로 다시 깨어날 수 있다. |
| `world.gravityTo({x,y}, ms=600)` | 현재 벡터에서 목표까지 스텝 시간으로 smoothstep 보간한다. 정반대 벡터는 중간에 영벡터를 지난다. 새 전환을 호출하면 그때의 중력부터 시작한다. `gravity()` 또는 `ms=0`은 즉시 적용한다. |
| `world.remove(body)` | 바디와 여기에 연결된 제약을 제거하고 남은 바디를 깨운다. |
| `body.pose(alpha=1)` | 직전 스텝과 현재 스텝 사이의 `{ x, y, angle }`을 반환한다. `alpha`의 범위는 0~1이다. |
| `body.shape`, `body.contains(x,y)` | 형상의 `radius` 또는 중심 기준 `points`는 사용자 렌더러에서 읽을 수 있다. `contains`는 현재 포즈를 기준으로 월드 좌표가 내부인지 확인한다. |

공간 해시가 겹칠 수 있는 바디 쌍을 찾고, 분리축과 모서리 클리핑으로 최대 두 접촉점을 만든다. 원과 다각형의 충돌에서는 모서리까지의 거리를 검사한다. 접촉점에서 각운동량과 마찰·반발 충격량을 반복 계산하고 다음 스텝에 이전 접촉 충격량을 초기값으로 사용한다. 접촉·제약으로 이어진 동적 바디는 모두 약 0.65초간 충분히 느릴 때 함께 잠든다. 같은 그룹의 바디가 깨어나면 다음 스텝에 나머지도 깨어난다.

### 재질

`world.add({ ...shape, material: 'hardFloor' })`로 프리셋을 고른다. `MATERIALS`에서 계수를 읽을 수 있고, 생성 옵션에 직접 준 계수가 프리셋보다 우선한다. 런타임에는 `world.setMaterial(body, 'mat')`처럼 이름을 주거나 `{friction,restitution,damping}` 객체를 준다. 물성 변경은 접촉 캐시를 비우고 바디를 깨운다.

| 프리셋 | 마찰 `friction` | 반발 `restitution` | 접촉 감쇠 `damping` |
| --- | ---: | ---: | ---: |
| 딱딱한 바닥 `hardFloor` | 0.60 | 0.40 | 0.02 |
| 매트 `mat` | 0.86 | 0.06 | 0.82 |
| 슬리퍼 `slipper` | 0.64 | 0.07 | 0.75 |
| 의자 다리 커버 `chairCover` | 0.19 | 0.08 | 0.72 |

마찰은 두 계수의 기하평균을 쓴다. 반발은 두 바디의 큰 반발계수에 `1 - max(dampingA, dampingB)`를 곱한다. 따라서 한쪽만 완충재를 써도 반발이 줄어든다. 계수는 방 데모를 위한 시뮬레이션 값이다.

### 접촉 충격량

`const unsubscribe = world.onImpact(listener)`는 솔버가 양의 법선 충격량을 적용한 각 접촉점에서 스텝당 한 번 호출한다. 콜백은 스텝이 끝난 뒤 실행되며, 이벤트에는 다음 값이 들어 있다.

- `a`, `b`는 ID 순서의 바디 객체다. `point:{x,y}`는 접촉점이며, `normal:{x,y}`는 `a`에서 `b`로 보는 법선이다.
- `normalImpulse`는 양의 법선 성분, `tangentImpulse`는 부호가 있는 마찰 성분, `impulse`는 두 성분의 합성 크기다. 단위는 질량 단위·px/s다.
- `closingSpeed`, `slipSpeed`는 이전 충격량을 적용하기 전 측정한 접근 속도와 접선 속력이다. 정지 물체를 지탱하는 충격량도 들어오므로 효과를 연결할 때 접근 속도나 마찰 충격량으로 필터링한다. 데모는 슬래브 접촉에서 `closingSpeed >= 45` 또는 `slipSpeed >= 28 && Math.abs(tangentImpulse) >= 1.6`을 사용한다.
- `tick`은 1부터 시작하는 스텝 번호, `time`은 월드에 누적된 초다. `dt`는 해당 스텝 길이(초), `gravity:{x,y}`는 충격 계산 순간 중력이다. 스텝당 접촉점이 여러 개면 같은 tick에 여러 이벤트가 온다.

### 기록과 재생

`replay.js`의 `recordImpacts(world, {filter, limit})`는 바디 참조를 `aId`, `bId`로 바꿔 JSON에 저장할 수 있는 이벤트를 만든다. `snapshot()`은 복사본을 반환하고 `stop()`은 구독을 해제한다. `limit`을 주면 최근 이벤트만 유지한다. `playImpactTrack(events,onImpact,{from=0})`에 시간순 이벤트를 주고 반환값의 `step(dt)`를 부르면 기록에 담긴 충격량·위치가 동일한 순서로 방출된다. `done`으로 마지막 이벤트 도달을 알 수 있다.

솔버를 다시 실행하려면 같은 초기 상태·바디 생성 순서·입력 처리기와 고정 간격을 사용한다.

```js
import { recordRun, replayRun } from './replay.js';

const run = recordRun(world, { apply, filter, dt: 1/120 });
run.input({ type: 'walk', x: 230 });        // apply(world, input)
for (let i = 0; i < 120; i++) run.step();
const tape = run.stop();                  // { dt, steps, inputs, impacts }
const rerun = replayRun(createWorld(), tape, { apply, filter });
```

입력 값은 일반 JSON 데이터로 기록한다. 같은 tick에 여러 입력이 있으면 들어온 순서대로 다음 물리 스텝 전에 적용된다. `apply`는 입력을 월드에 적용하고 시간 전진은 `run.step()`이 담당한다. 같은 엔진과 JS 런타임에서 재계산한 충격량 열의 정확한 일치를 회귀로 검사한다. 기록값 자체를 재생할 때는 월드 재계산이 필요 없다.

### 거리, 로프, 스프링

`world.link(a, b, options)`가 반환한 제약은 `world.unlink(link)`로 제거한다. 두 바디의 `anchorA`와 `anchorB`는 중심 기준 로컬 좌표다. `b=null`이면 `anchorB`가 고정 월드 좌표다. 기본 `length`는 생성 시 앵커 사이의 거리다.

- 거리 고정은 `{ length: 48 }`처럼 지정한다.
- 로프는 `{ length: 90, rope: true }`로 최대 길이를 제한한다. 느슨할 때는 미는 힘이 없다.
- 스프링은 `{ length: 48, frequency: 4, damping: 0.8 }`처럼 진동수(Hz)와 감쇠비를 설정한다. `maxForce`로 힘의 크기를 선택적으로 제한한다.
- 말랑한 장면은 여러 원을 드러나는 둘레와 내부 대각선의 스프링으로 연결한다. 접촉이 계속 계산되므로 연결한 원도 겹치면 충돌한다. 강한 스프링이나 긴 사슬은 더 짧은 스텝과 더 많은 솔버 반복이 필요할 수 있다.
- 월드 앵커를 이동하려면 `link.anchorB = {x,y}`로 교체하고 `world.wake(a)`를 호출한다.
- 진자 조명은 월드에 고정한 거리 제약을 쓰고 `world.pulseLink(link,{x,y})`로 지지점에 외부 충격을 준다. 벡터는 단위 질량 지지점의 속도 변화(px/s)다. 지지점은 감쇠하며 돌아오고, 거리 제약 솔버가 지지점의 변위와 속도를 추에 전달한다. `world.linkAnchor(link)`로 진동을 포함한 지지점의 월드 좌표를 읽어 줄을 그릴 수 있다. 방 데모에서는 슬래브 충격량과 접촉점으로 이 벡터를 계산한다.

## 브라우저 어댑터

| API | 동작 |
| --- | --- |
| `fixedLoop(world, target, render, options)` | 기본 `dt=1/120`, `maxSteps=8`로 누적 시간을 스텝에 배분하고 `render(alpha)`를 호출한다. IntersectionObserver로 대상이 화면을 벗어날 때, 또는 문서가 숨겨질 때 멈춘다. 다시 보이면 경과 시간 누적을 초기화한다. `pause()`, `resume()`, `destroy()`를 반환한다. |
| `options.onReduced(reduced)` | 초기 상태와 설정 변경 시 호출된다. `reduced`가 참이면 프레임 루프를 멈추고 현재 포즈를 한 번 그린다. 콜백에서 장면의 정적 대체 상태를 적용한다. |
| `bindDOM(body, element)` | `render(alpha)`가 HTML 요소의 중앙을 바디 포즈에 맞춘다. `destroy()`는 기존 인라인 transform과 원점을 복원한다. 레이아웃 크기로 바디를 만든다. 카드 내용이나 레이아웃이 바뀌어 크기가 달라지면 해당 바디를 다시 만들어 바인딩한다. |
| `contain(world, element, onResize?)` | ResizeObserver가 요소 내부의 네 벽을 갱신한다. 기존 바디를 새 경계 안으로 옮기고 `onResize(width,height)`를 호출한다. 반환 함수로 감시와 벽을 해제한다. |
| `dragPointer(world, element, { pick }={})` | 활성 포인터 하나를 캡처하고 감쇠 스프링으로 잡은 지점을 따라간다. 최근 포인터 이동을 놓는 순간 속도에 반영한다. `pick(event,{x,y})`로 HTML 손잡이와 특정 바디를 짝지을 수 있다. 기본값은 월드에서 가장 나중에 추가된 동적 바디부터 히트 테스트한다. 반환 함수로 드래그를 해제한다. |
| `orientationToGravity({beta,gamma}, {angle=0,strength=1000}={})` | DeviceOrientation의 각도(도)를 화면 좌표계 중력으로 바꾸는 순수 함수다. 수평에서는 화면 내 중력이 0에 가깝다. 센서 수치가 없으면 `null`을 반환한다. |
| `requestOrientation({onFailure}={})` | iOS 권한 API가 있으면 호출한다. HTTPS 등 보안 컨텍스트에서 사용자 클릭 핸들러로 직접 시작한다. `enabled`, `denied`, `unavailable`을 반환하며 실패 시 같은 값을 콜백에도 전달한다. |
| `tiltGravity(world, { strength=1000, threshold=18, sampleTimeout=1800, onFailure, onGravity }={})` | `start()`가 권한을 요청하고 센서 값을 화면 회전에 맞춰 평활화한다. `onGravity(vec)`를 주면 중력 입력을 앱의 기록 디스패처로 보낼 수 있다. 기본값은 즉시 `world.gravity(vec.x,vec.y)`를 호출한다. `stop()`은 구독을 해제하고 센서 입력이 있었으면 시작 중력을 복원한다. |

`tiltGravity.start()`는 `enabled`(구독 시작), `denied`, `unavailable`, `cancelled`를 반환한다. 구독 후 유효한 샘플이 들어오지 않으면 `onFailure('no-sample')`로 알려 버튼 대체 경로를 사용할 수 있다. 사용자 클릭에서 `start()`를 먼저 호출해 iOS의 사용자 제스처를 보존한다.

## Node 벤치마크와 검증

```sh
node proto/physics/verify.mjs
node proto/physics/bench.mjs
```

Linux x64, AMD Ryzen 9 5900X, Node v22.23.4에서 측정했다. 고정 벽 4개, 동적 원·상자·삼각형 혼합, 중력 780, 셀 30px, 솔버 10회, 물리 스텝 1/120초, 수면 해제 조건이다. 각 바디 수에서 새 월드를 만들어 240스텝 예열 후 600스텝을 재는 과정을 세 번 반복했다. 표는 렌더링과 입력 비용을 제외한 **물리 스텝 처리량**이다.

| 동적 바디 수 | 중앙값 (스텝/초) | 최저–최고 (스텝/초) |
| ---: | ---: | ---: |
| 50 | 6,375 | 6,102–6,380 |
| 150 | 1,898 | 1,898–1,913 |
| 300 | 909 | 889–929 |

v0.3에서는 같은 호스트에서 건물에 던지기·끌기·비교 낙하를 순환 입력하며 240스텝 예열 뒤 1,800스텝을 측정했다. 아래 값은 `building.step()`의 Node 실행 시간이다.

| 장면 | 동적/고정 바디 | 중앙값 (ms/스텝) | 95백분위 (ms/스텝) |
| --- | ---: | ---: | ---: |
| 맨바닥 | 10/6 | 0.056 | 0.111 |
| 매트 | 10/7 | 0.042 | 0.107 |

v0.3에서 다시 잰 동적 강체 300개 처리량은 중앙값 952스텝/초(820~1,029)다. 센서 검사는 화면 방향 보정과 듣기 상태 고정, 흔들기 및 뒤집힌 매트의 아랫면 접촉 전달 0건을 모의 입력으로 확인했다.

회귀 검사는 기존 충돌·수면·제약·보간을 유지하며 접촉당 이벤트, 재질 변경, 중력 램프, 진자, 권한 대체 흐름과 JSON 결정적 재생을 확인한다. 새 건물 검사에서는 정방향 6→5, 반전 6→7, 양 방향 천장 전달 0건, 기준 낙하 100, 0.25초 힘 집계, 회전 상한과 입력 차단, 두 경로의 재생을 확인했다. 방에서 같은 걸음을 입력한 결과 딱딱한 바닥에서 매트로 바꾸면 충격량이 702.61에서 519.08로, 2초 동안의 진자 최대 수평 변위는 9.38px에서 6.57px로 줄었다. 새 데모 입력은 Node의 모의 DOM과 Canvas에서 확인했으며 실제 브라우저 렌더링 확인이 남았다. 충돌은 이산 방식이라 고속 바디가 한 스텝에 얇은 형상을 통과할 수 있다.

코드, 카드 HTML, 도형은 이 프로토타입에서 작성했다.
