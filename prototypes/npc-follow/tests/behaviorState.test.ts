// NPC 행동 상태 전환 규칙 단위 테스트 (Node 내장 테스트 러너, 추가 패키지 없음)
// 실행: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createFollowCommands,
  createNpcBehaviorStore,
  INITIAL_BEHAVIOR_STATE,
  reduceNpcBehavior,
} from '../src/npc/behaviorState.ts'
import type { NpcBehaviorEvent } from '../src/npc/behaviorState.ts'

test('초기 상태는 Follow', () => {
  assert.deepEqual(createNpcBehaviorStore().getState(), { current: 'Follow', resumeTo: null })
})

test('Follow → Idle → Follow (외부 명령)', () => {
  const store = createNpcBehaviorStore()
  const commands = createFollowCommands(store)
  assert.equal(commands.stopFollow('test').accepted, true)
  assert.equal(store.getState().current, 'Idle')
  assert.equal(commands.startFollow('test').accepted, true)
  assert.equal(store.getState().current, 'Follow')
})

test('Follow → Interact → Follow 복귀', () => {
  const store = createNpcBehaviorStore()
  store.dispatch({ type: 'START_INTERACT' })
  assert.deepEqual(store.getState(), { current: 'Interact', resumeTo: 'Follow' })
  store.dispatch({ type: 'END_INTERACT' })
  assert.deepEqual(store.getState(), { current: 'Follow', resumeTo: null })
})

test('Idle → Interact → Idle 복귀', () => {
  const store = createNpcBehaviorStore({ current: 'Idle', resumeTo: null })
  store.dispatch({ type: 'START_INTERACT' })
  assert.deepEqual(store.getState(), { current: 'Interact', resumeTo: 'Idle' })
  store.dispatch({ type: 'END_INTERACT' })
  assert.deepEqual(store.getState(), { current: 'Idle', resumeTo: null })
})

test('대화 중 동행 시작·중지 명령은 거부되고 복귀 상태도 바뀌지 않는다', () => {
  const store = createNpcBehaviorStore()
  store.dispatch({ type: 'START_INTERACT' })
  const stop = store.dispatch({ type: 'STOP_FOLLOW', source: 'backend' })
  const start = store.dispatch({ type: 'START_FOLLOW', source: 'backend' })
  assert.equal(stop.accepted, false)
  assert.equal(stop.reason, 'busy-interacting')
  assert.equal(start.reason, 'busy-interacting')
  assert.deepEqual(store.getState(), { current: 'Interact', resumeTo: 'Follow' })
  store.dispatch({ type: 'END_INTERACT' })
  assert.equal(store.getState().current, 'Follow')
})

test('중복 이벤트: 대화 시작·종료를 여러 번 보내도 상태가 꼬이지 않는다', () => {
  const store = createNpcBehaviorStore({ current: 'Idle', resumeTo: null })
  assert.equal(store.dispatch({ type: 'START_INTERACT' }).accepted, true)
  const again = store.dispatch({ type: 'START_INTERACT' })
  assert.equal(again.accepted, false)
  assert.equal(again.reason, 'already-in-state')
  // 두 번째 시작이 resumeTo를 Interact로 덮어쓰면 안 된다
  assert.deepEqual(store.getState(), { current: 'Interact', resumeTo: 'Idle' })

  assert.equal(store.dispatch({ type: 'END_INTERACT' }).accepted, true)
  const endAgain = store.dispatch({ type: 'END_INTERACT' })
  assert.equal(endAgain.accepted, false)
  assert.equal(endAgain.reason, 'not-interacting')
  assert.deepEqual(store.getState(), { current: 'Idle', resumeTo: null })
})

test('같은 상태로의 명령은 거부 (Follow에서 START_FOLLOW, Idle에서 STOP_FOLLOW)', () => {
  assert.equal(reduceNpcBehavior(INITIAL_BEHAVIOR_STATE, { type: 'START_FOLLOW' }).reason, 'already-in-state')
  assert.equal(
    reduceNpcBehavior({ current: 'Idle', resumeTo: null }, { type: 'STOP_FOLLOW' }).reason,
    'already-in-state',
  )
})

test('구독자는 실제로 바뀐 전환만 받는다', () => {
  const store = createNpcBehaviorStore()
  const seen: string[] = []
  const unsubscribe = store.subscribe((r) => seen.push(`${r.previous.current}→${r.state.current}`))
  store.dispatch({ type: 'START_FOLLOW' }) // 거부
  store.dispatch({ type: 'STOP_FOLLOW' })
  store.dispatch({ type: 'START_INTERACT' })
  store.dispatch({ type: 'START_INTERACT' }) // 거부
  store.dispatch({ type: 'END_INTERACT' })
  unsubscribe()
  store.dispatch({ type: 'START_FOLLOW' }) // 구독 해제 후
  assert.deepEqual(seen, ['Follow→Idle', 'Idle→Interact', 'Interact→Idle'])
})

test('무작위 이벤트 1만 개: 항상 유효한 상태 조합을 유지한다', () => {
  const events: NpcBehaviorEvent['type'][] = ['START_FOLLOW', 'STOP_FOLLOW', 'START_INTERACT', 'END_INTERACT']
  const store = createNpcBehaviorStore()
  let seed = 12345
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 10000; i++) {
    const before = store.getState()
    const type = events[Math.floor(random() * events.length)]
    const result = store.dispatch({ type })
    const s = store.getState()
    // Interact일 때만 resumeTo가 있고, 그 값은 Idle 또는 Follow
    if (s.current === 'Interact') assert.ok(s.resumeTo === 'Idle' || s.resumeTo === 'Follow')
    else assert.equal(s.resumeTo, null)
    // 거부된 이벤트는 상태를 바꾸지 않는다
    if (!result.accepted) assert.equal(s, before)
    // 대화 종료 시 시작 직전 상태로 돌아간다
    if (result.accepted && type === 'END_INTERACT') assert.equal(s.current, before.resumeTo)
  }
})
