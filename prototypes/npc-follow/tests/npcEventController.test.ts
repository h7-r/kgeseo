// NPC 이벤트 컨트롤러 단위 테스트 (Node 내장 테스트 러너)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNpcBehaviorStore } from '../src/npc/behaviorState.ts'
import { createNpcEventController } from '../src/npc/npcEventController.ts'
import type { GameEvent } from '../src/npc/gameEvents.ts'

let counter = 0
function ev(event_type: GameEvent['event_type'], target_id: string, event_id = `e${++counter}`): GameEvent {
  return { event_id, event_type, target_id, source: 'test' } as GameEvent
}

function setup(initial: 'Idle' | 'Follow' = 'Follow') {
  const store = createNpcBehaviorStore({ current: initial, resumeTo: null })
  const controller = createNpcEventController(store)
  return { store, controller }
}

test('1. test_clue_01 단서 획득 → Idle', () => {
  const { store, controller } = setup()
  const r = controller.handle(ev('clue_acquired', 'test_clue_01'))
  assert.equal(r.status, 'applied')
  assert.equal(store.getState().current, 'Idle')
})

test('2. test_puzzle_01 퍼즐 완료 → Follow', () => {
  const { store, controller } = setup('Idle')
  const r = controller.handle(ev('puzzle_completed', 'test_puzzle_01'))
  assert.equal(r.status, 'applied')
  assert.equal(store.getState().current, 'Follow')
})

test('3. test_zone_01 구역 진입 → Idle', () => {
  const { store, controller } = setup()
  assert.equal(controller.handle(ev('zone_entered', 'test_zone_01')).status, 'applied')
  assert.equal(store.getState().current, 'Idle')
})

test('4. 정의되지 않은 대상·종류 조합은 무시하고 상태를 바꾸지 않는다', () => {
  const { store, controller } = setup()
  const unknownTarget = controller.handle(ev('clue_acquired', 'other_clue'))
  // 대상 ID는 규칙에 있지만 이벤트 종류가 다른 경우도 무시
  const wrongType = controller.handle(ev('zone_entered', 'test_clue_01'))
  assert.equal(unknownTarget.status, 'ignored')
  assert.equal(unknownTarget.reason, 'no-rule')
  assert.equal(wrongType.reason, 'no-rule')
  assert.equal(store.getState().current, 'Follow')
})

test('4-1. 계약에 맞지 않는 데이터는 invalid로 무시', () => {
  const { store, controller } = setup()
  for (const bad of [
    null,
    'clue_acquired',
    { event_id: 'x1', event_type: 'clue_acquired', target_id: 'test_clue_01' }, // source 없음
    { event_id: '', event_type: 'clue_acquired', target_id: 'test_clue_01', source: 's' },
    { event_id: 'x2', event_type: 'npc_spawned', target_id: 'test_clue_01', source: 's' },
  ]) {
    assert.equal(controller.handle(bad).reason, 'invalid')
  }
  assert.equal(store.getState().current, 'Follow')
})

test('5. 같은 event_id는 한 번만 처리 (내용이 달라도)', () => {
  const { store, controller } = setup()
  assert.equal(controller.handle(ev('clue_acquired', 'test_clue_01', 'dup')).status, 'applied')
  controller.handle(ev('puzzle_completed', 'test_puzzle_01', 'p1'))
  assert.equal(store.getState().current, 'Follow')
  const again = controller.handle(ev('clue_acquired', 'test_clue_01', 'dup'))
  assert.equal(again.status, 'ignored')
  assert.equal(again.reason, 'duplicate')
  assert.equal(store.getState().current, 'Follow')
})

test('5-1. 이미 그 상태면 no-change로 무시', () => {
  const { controller } = setup('Idle')
  const r = controller.handle(ev('clue_acquired', 'test_clue_01'))
  assert.equal(r.status, 'ignored')
  assert.equal(r.reason, 'no-change')
})

test('6·7. 대화 중 이벤트는 보류되고, 대화 종료 후 적용된다', () => {
  const { store, controller } = setup()
  store.dispatch({ type: 'START_INTERACT' })
  const r = controller.handle(ev('clue_acquired', 'test_clue_01'))
  assert.equal(r.status, 'deferred')
  assert.deepEqual(store.getState(), { current: 'Interact', resumeTo: 'Follow' })
  assert.equal(controller.getSnapshot().pending.length, 1)

  store.dispatch({ type: 'END_INTERACT' })
  assert.equal(store.getState().current, 'Idle')
  assert.equal(controller.getSnapshot().pending.length, 0)
  const last = controller.getSnapshot().log.at(-1)!
  assert.equal(last.status, 'applied')
  assert.equal(last.phase, 'flush')
})

test('6-1. 대화 중 같은 이벤트가 여러 번 와도 한 번만 보류·적용', () => {
  const { store, controller } = setup()
  store.dispatch({ type: 'START_INTERACT' })
  const first = controller.handle(ev('zone_entered', 'test_zone_01', 'z1'))
  const second = controller.handle(ev('zone_entered', 'test_zone_01', 'z1'))
  assert.equal(first.status, 'deferred')
  assert.equal(second.reason, 'duplicate')
  assert.equal(controller.getSnapshot().pending.length, 1)
  store.dispatch({ type: 'END_INTERACT' })
  const flushed = controller.getSnapshot().log.filter((l) => l.phase === 'flush')
  assert.equal(flushed.length, 1)
  assert.equal(store.getState().current, 'Idle')
})

test('8. 여러 보류 이벤트: 받은 순서대로 판단하고 마지막 것만 적용(앞선 것은 superseded)', () => {
  const { store, controller } = setup()
  store.dispatch({ type: 'START_INTERACT' })
  controller.handle(ev('clue_acquired', 'test_clue_01', 'a')) // Idle
  controller.handle(ev('puzzle_completed', 'test_puzzle_01', 'b')) // Follow
  controller.handle(ev('zone_entered', 'test_zone_01', 'c')) // Idle
  assert.deepEqual(controller.getSnapshot().pending.map((e) => e.event_id), ['a', 'b', 'c'])

  store.dispatch({ type: 'END_INTERACT' })
  const flushed = controller.getSnapshot().log.filter((l) => l.phase === 'flush')
  assert.deepEqual(
    flushed.map((l) => `${l.event?.event_id}:${l.status}:${l.reason ?? ''}`),
    ['a:ignored:superseded', 'b:ignored:superseded', 'c:applied:'],
  )
  assert.equal(store.getState().current, 'Idle')
})

test('8-1. 보류된 마지막 이벤트가 대화 전 상태와 같으면 no-change', () => {
  const { store, controller } = setup('Idle')
  store.dispatch({ type: 'START_INTERACT' })
  controller.handle(ev('puzzle_completed', 'test_puzzle_01')) // Follow
  controller.handle(ev('clue_acquired', 'test_clue_01')) // Idle (대화 전 상태와 같음)
  store.dispatch({ type: 'END_INTERACT' })
  assert.equal(store.getState().current, 'Idle')
  assert.equal(controller.getSnapshot().log.at(-1)!.reason, 'no-change')
})

test('8-2. 같은 입력 순서면 언제나 같은 결과 (결정적)', () => {
  const run = () => {
    const { store, controller } = setup()
    store.dispatch({ type: 'START_INTERACT' })
    for (const [type, target, id] of [
      ['zone_entered', 'test_zone_01', 'x'],
      ['clue_acquired', 'unknown', 'y'],
      ['puzzle_completed', 'test_puzzle_01', 'z'],
      ['zone_entered', 'test_zone_01', 'x'],
    ] as const) {
      controller.handle(ev(type, target, id))
    }
    store.dispatch({ type: 'END_INTERACT' })
    return [store.getState().current, ...controller.getSnapshot().log.map((l) => `${l.seq}:${l.status}:${l.reason ?? ''}`)]
  }
  assert.deepEqual(run(), run())
  assert.equal(run()[0], 'Follow')
})

test('대화 종료 알림과 보류 이벤트 적용 알림이 순서대로 전달된다', () => {
  const { store, controller } = setup()
  const seen: string[] = []
  store.subscribe((r) => seen.push(`${r.previous.current}→${r.state.current}`))
  store.dispatch({ type: 'START_INTERACT' })
  controller.handle(ev('clue_acquired', 'test_clue_01'))
  store.dispatch({ type: 'END_INTERACT' })
  assert.deepEqual(seen, ['Follow→Interact', 'Interact→Follow', 'Follow→Idle'])
})

test('대화 중 사용자가 보낸 동행 명령은 여전히 저장소가 거부한다 (기존 정책 유지)', () => {
  const { store } = setup()
  store.dispatch({ type: 'START_INTERACT' })
  assert.equal(store.dispatch({ type: 'STOP_FOLLOW' }).reason, 'busy-interacting')
})

test('dispose 후에는 대화 종료 시 보류분을 처리하지 않는다', () => {
  const { store, controller } = setup()
  store.dispatch({ type: 'START_INTERACT' })
  controller.handle(ev('clue_acquired', 'test_clue_01'))
  controller.dispose()
  store.dispatch({ type: 'END_INTERACT' })
  assert.equal(store.getState().current, 'Follow')
})
