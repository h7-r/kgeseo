// 준비된 몸의 재질 쪽 훅들 — 늦춘 반납, 툰·외곽선 붙이기, 파츠 표시·모프·색 칠하기.
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { DEFAULT_MESH_CONFIG, type MeshAppearanceConfig } from "./meshAppearance";
import { type ChibiAvatarConfig, type ChibiBody, DEFAULT_CHIBI_CONFIG, type PreparedBody } from "./preparedBody";
import { setMorph } from "./rig";
import { applyToon, type ToonConfig, type ToonHandle, type ToonPartKind } from "./toonMaterial";
import { applyOutline, type OutlineConfig, type OutlineHandle } from "./toonOutline";

function setMaterialColor(material: THREE.Material, color: string) {
  if ("color" in material && material.color instanceof THREE.Color) material.color.set(color);
}

/**
 * 반납은 두 프레임 미룬다. three 는 같은 셰이더 재질끼리 프로그램을 돌려쓰며 쓰는 수를 세는데,
 * 앞 재질을 먼저 버리면 프로그램이 지워지고 새 재질이 같은 셰이더를 처음부터 다시 링크한다.
 * 새 재질이 한 번 그려진 뒤 버리면 그대로 물려받는다.
 * 밀려난 몸도 이 길로 제 GPU 자원을 반납한다.
 */
export function useDeferredDisposal(prepared: PreparedBody) {
  const pendingDisposals = useRef<(() => void)[]>([]);
  const defer = useCallback((task: () => void) => {
    pendingDisposals.current.push(task);
    // 이미 예약돼 있다
    if (pendingDisposals.current.length > 1) return;
    const flush = () => {
      const tasks = pendingDisposals.current;
      pendingDisposals.current = [];
      tasks.forEach((f) => {
        try {
          f();
        } catch {
          // 반납이 실패해도 화면은 그대로 돈다
        }
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(flush));
  }, []);

  // 정리 함수로 버리지 않는다 — StrictMode 의 「실행 → 정리 → 다시 실행」 에서 지금 쓰는 몸을 버리게 된다.
  const previousPrepared = useRef<PreparedBody | null>(null);
  useEffect(() => {
    const previous = previousPrepared.current;
    previousPrepared.current = prepared;
    if (previous && previous !== prepared) defer(() => previous.dispose());
  }, [prepared, defer]);

  return defer;
}

/** 재질은 준비(모델)당 한 번만 갈아 끼우고 세기 같은 값은 uniform 으로만 바꾼다. 끄면 원본 재질로 돌아간다. */
export function useToonAndOutline(
  prepared: PreparedBody,
  toon: ToonConfig,
  outline: OutlineConfig,
  defer: (task: () => void) => void,
) {
  const classify = useMemo(
    () =>
      (object: THREE.Object3D): ToonPartKind => {
        let owner: THREE.Object3D | null = object;
        while (owner && owner.userData.slot === undefined && owner.userData.chibi_part === undefined)
          owner = owner.parent;
        const slot = owner?.userData.slot ?? owner?.userData.chibi_part ?? "body";
        return slot === "hair" ? "hair" : slot === "body" ? "body" : "cloth";
      },
    [],
  );
  const toonHandle = useRef<ToonHandle | null>(null);
  const outlineHandle = useRef<OutlineHandle | null>(null);
  // 그리기 전에 붙인다(useLayoutEffect). useEffect 면 툰·외곽선 없는 반쪽 몸이 한 프레임 나가고,
  // 바로 다음 프레임이 새 모델을 올리느라 멈춰 그 그림이 오래 굳어 있다.
  useLayoutEffect(() => {
    if (!toon.enabled) return undefined;
    const handle = applyToon(prepared.model, classify, toon);
    toonHandle.current = handle;
    return () => {
      toonHandle.current = null;
      // 곧바로 버리면 셰이더를 다시 링크한다.
      defer(() => handle.restore());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 그라디언트 맵이 바뀌는 단계·경계만 재질을 다시 만든다. 나머지는 update 로
  }, [prepared, classify, toon.enabled, toon.steps, toon.threshold, defer]);
  useEffect(() => {
    toonHandle.current?.update(toon);
  }, [toon]);
  useLayoutEffect(() => {
    if (!outline.enabled) return undefined;
    const handle = applyOutline(prepared.model, outline, classify);
    outlineHandle.current = handle;
    return () => {
      outlineHandle.current = null;
      // 껍데기는 이미 화면 밖(밀려난 몸)에 있다 — 늦게 걷어도 보이는 것은 같다.
      defer(() => handle.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 두께·색은 update 로만 바꾸고 껍데기는 켬/끔에만 다시 만든다
  }, [prepared, classify, outline.enabled, defer]);
  useEffect(() => {
    outlineHandle.current?.update(outline);
  }, [outline]);
  return { toonHandle, outlineHandle };
}

interface AppearancePaintInput {
  prepared: PreparedBody;
  config: ChibiAvatarConfig;
  body: ChibiBody;
  toonEnabled: boolean;
  toonHandle: RefObject<ToonHandle | null>;
  outlineHandle: RefObject<OutlineHandle | null>;
}

/** 파츠 표시·모프·색. Meshy 파츠는 텍스처가 색을 담고 있어 선택 색을 곱한다. 외형 값을 돌려준다. */
export function useAppearancePaint({
  prepared,
  config,
  body,
  toonEnabled,
  toonHandle,
  outlineHandle,
}: AppearancePaintInput): MeshAppearanceConfig {
  const appearance = useMemo<MeshAppearanceConfig>(
    () => ({ ...DEFAULT_MESH_CONFIG, ...config }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 외형 값만 본다. 동작(motion)만 바뀌면 다시 칠하지 않는다
    [
      config.hair,
      config.shoes,
      config.skinColor,
      config.hairColor,
      config.clothColor,
      config.bottomColor,
      config.shoesColor,
      config.gender,
      config.shoulderWidth,
      config.hipWidth,
      config.buff,
      config.heavy,
      config.skinny,
      config.armThickness,
      config.legThickness,
      config.handScale,
      config.footScale,
      config.fistHands,
    ],
  );

  // 그리기 전에 맞춘다. 새 몸은 GLB 파츠가 전부 보이는 채 시작해, 늦으면 안 고른 머리와 벗은 신발이
  // 한 프레임 같이 보인다(머리가 겹쳐 '귀가 하나 더').
  useLayoutEffect(() => {
    if (body !== "meshy") {
      prepared.skinMaterials.forEach((material) =>
        setMaterialColor(material, config.skinColor ?? DEFAULT_CHIBI_CONFIG.skinColor ?? ""),
      );
      return;
    }
    const colors: Record<string, string | undefined> = {
      body: appearance.skinColor,
      hair: appearance.hairColor,
      top: appearance.clothColor,
      bottom: appearance.bottomColor ?? appearance.clothColor,
      // 신발은 따로 된 GLB 라 정점 표식이 없다 — 재질 색을 그대로 곱한다
      shoes: appearance.shoesColor ?? "#ffffff",
    };
    const wearsShoes = (appearance.shoes ?? -1) >= 0;
    // 슬라이더 → morph target. 어깨는 뼈로 넓히고(모프는 팔이 처진다), 신발을 신으면 발은 발뼈 배율로 키운다.
    const morphs: Record<string, number> = {
      heavy: appearance.heavy,
      skinny: appearance.skinny,
      buff: appearance.buff,
      shoulderWidth: 0,
      hipWidth: (appearance.hipWidth - 1) / 0.3,
      armThickness: (appearance.armThickness - 1) / 0.3,
      legThickness: (appearance.legThickness - 1) / 0.3,
      handScale: (appearance.handScale - 1) / 0.3,
      footScale: wearsShoes ? 0 : (appearance.footScale - 1) / 0.3,
      // 평소 손 모양(옷장). 물건을 들 때 감는 건 useFrame 이 이 위에 얹는다 — 지우면 옷장 미리보기 손이 안 바뀐다.
      fistHands: appearance.fistHands,
    };
    // 몸과 옷은 한 메시라 재질 색으로는 못 가른다. 정점 표식이 있는 툰 재질일 때만 피부·의상을 따로 칠한다.
    const hasTintMarks = Boolean(toonHandle.current?.hasTintMarks);
    prepared.parts.forEach(({ object, slot, variant }) => {
      if (slot === "hair" || slot === "shoes") object.visible = variant === appearance[slot];
      Object.entries(morphs).forEach(([key, value]) => setMorph(object, key, value));
      const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
      const paint = slot === "hair" || slot === "shoes" || !hasTintMarks ? (colors[slot] ?? "#ffffff") : "#ffffff";
      materials.forEach((material) => setMaterialColor(material, paint));
    });
    // 숨긴 파츠의 외곽선 껍데기도 같이 숨긴다 — 안 그러면 맨발에 검은 신발 실루엣이 남는다.
    outlineHandle.current?.syncVisibility();
    toonHandle.current?.tint({
      skin: appearance.skinColor,
      cloth: appearance.clothColor,
      // 하의는 정점 표식 3 으로 따로 칠한다
      bottom: appearance.bottomColor ?? appearance.clothColor,
    });
    // 툰 재질이 붙은 뒤에 칠해야 하므로 툰 켬/끔도 의존성에 둔다. 핸들 상자는 늘 같은 ref 다.
  }, [prepared, appearance, body, config.skinColor, toonEnabled, toonHandle, outlineHandle]);

  return appearance;
}
