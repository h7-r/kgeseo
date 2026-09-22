import 에셋 from "../에셋.js";
import { 놓기 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   배경 장식 — 번지는 푸른 빛과 큰 원들

   내용이 아니라 분위기를 만드는 층이다. 전부 피그마가 내보낸 SVG 를
   그대로 쓴다(그라디언트와 블러가 이미 구워져 있다).

   [칠하는 순서가 중요하다]
   피그마는 레이어 순서대로 칠한다. 큰빛(14:1237)과 가운데빛(12:2336)은
   원본에서 **한참 뒤에** 칠해져서 렌즈와 왼쪽 글 위를 덮는다. 그래서 이
   둘만 따로 내보내고, 시작화면이 알맞은 자리에서 부른다.
   전부 먼저 깔면 렌즈가 빛 위로 떠올라 검은 덩어리처럼 보인다.

   [왜 pointerEvents: "none" 을 다는가]
   이 층들은 **보이기만 하는 그림**인데, 크기가 커서 단추 위를 덮는다.
   그냥 두면 「모든 지역 보기」 같은 단추를 눌러도 글로우가 클릭을 먹어서
   아무 일도 안 일어난다(실제로 그 버그가 났다). 장식은 클릭을 통과시킨다.

   [넘침(inset) 이 왜 음수인가]
   피그마에서 글로우는 칸보다 **큰 그림**이다. 칸이 기준점이고 그림은
   사방으로 흘러넘친다. 그래서 top/left 가 음수 퍼센트로 들어간다.
   여기서 퍼센트를 px 로 바꾸면 화면 크기에 따라 어긋난다 — 그대로 둔다.
   ═══════════════════════════════════════════════════════ */

export default function 배경장식() {
  return (
    <>
      {/* 121:2554 — 영상 아래 큰 겹원 */}
      <div style={{ ...놓기(606, 3949, 960, 960), ...통과 }} data-node-id="121:2554">
        <div style={{ position: "absolute", top: "-0.32%", right: "-0.33%", bottom: "-0.33%", left: "-0.32%" }}>
          <img src={에셋.imgGroup29} alt="" style={꽉} />
        </div>
      </div>

      {/* 121:2377 — 지역 카드 아래 큰 겹원 */}
      <div style={{ ...놓기(472, 5967, 960, 960), ...통과 }} data-node-id="121:2377">
        <div style={{ position: "absolute", top: "-0.19%", right: "-0.2%", bottom: "-0.2%", left: "-0.19%" }}>
          <img src={에셋.imgGroup28} alt="" style={꽉} />
        </div>
      </div>

      {/* 14:1238 — 왼쪽 위로 비스듬히 누운 빛 */}
      <회전빛 칸={놓기(-269, 1416, 784.758, 592.635)} 각도={10.37} 폭={711.356} 높이={472.29}
        넘침={{ top: "-42.35%", bottom: "-42.35%", left: "-28.12%", right: "-28.12%" }}
        그림={에셋.imgEllipse} 이름="14:1238" />

      {/* 40:1419 — 오른쪽 가운데 */}
      <회전빛 칸={놓기(1310, 2877, 538, 401.077)} 각도={10.37} 폭={488.682} 높이={318.303}
        넘침={{ top: "-62.83%", bottom: "-62.83%", left: "-40.93%", right: "-40.93%" }}
        그림={에셋.imgEllipse1} 이름="40:1419" />

      {/* 21:1114(가입 폼 왼쪽 세로 렌즈)는 **빼 두었다.**
          모양이 거의 안 보이고 얇은 타원 외곽선만 남아서, 카드 옆에
          정체 불명의 동그란 선처럼 보였다. 되살리려면 이 자리에
          imgGroup143 / imgGroup153 을 회전빛으로 다시 넣으면 된다. */}
    </>
  );
}

function 회전빛({ 칸, 각도, 기울기, 폭, 높이, 넘침, 그림, 이름 }) {
  return (
    <div style={{ ...칸, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }} data-node-id={이름}>
      <div style={{ flex: "none", transform: `rotate(${각도}deg)${기울기 ? ` skewX(${기울기}deg)` : ""}` }}>
        <div style={{ position: "relative", width: `${폭}px`, height: `${높이}px` }}>
          <div style={{ position: "absolute", ...넘침 }}>
            <img src={그림} alt="" style={꽉} />
          </div>
        </div>
      </div>
    </div>
  );
}

const 꽉 = { display: "block", width: "100%", height: "100%", maxWidth: "none" };

/* 장식은 클릭을 통과시킨다 — 위 주석 참고 */
const 통과 = { pointerEvents: "none" };

/** 12:2336 — 지역 선택 구간 한가운데 동그란 빛. 왼쪽 글 **위**에 얹힌다. */
export function 가운데빛() {
  return (
    <div
      style={{ position: "absolute", left: "946px", top: "4646px", width: "330px", height: "330px", transform: "translate(-50%, -50%)", pointerEvents: "none" }}
      data-node-id="12:2336"
    >
      <div style={{ position: "absolute", inset: "-151.52%" }}>
        <img src={에셋.imgEllipse5} alt="" style={꽉} />
      </div>
    </div>
  );
}

/** 14:1237 — 두 번째 화면 오른쪽 가장 큰 빛. 렌즈(21:1114) **위**, 가입폼 **아래**. */
export function 큰빛() {
  return (
    <회전빛
      칸={놓기(919, 1686.44, 1120.002, 926.674)} 각도={-11.84} 폭={989.322} 높이={739.38}
      넘침={{ top: "-40.57%", bottom: "-40.57%", left: "-30.32%", right: "-30.32%" }}
      그림={에셋.imgEllipse8} 이름="14:1237"
    />
  );
}
