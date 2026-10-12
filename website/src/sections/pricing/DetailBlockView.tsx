import type { DetailBlock } from "@/data/pricingDetails";

/** 자세히 보기 모달의 한 덩이. 제목 아래 모양(목록·절차·풀이·이름표·계산)만 갈린다. */
export default function DetailBlockView({ block }: { block: DetailBlock }) {
  return (
    <section className="pricing-detail__block">
      <h3 className="pricing-detail__heading">{block.heading}</h3>
      <DetailBody block={block} />
    </section>
  );
}

function DetailBody({ block }: { block: DetailBlock }) {
  switch (block.kind) {
    case "list":
    case "steps": {
      const ListTag = block.kind === "steps" ? "ol" : "ul";
      return (
        <ListTag className={`pricing-detail__${block.kind}`}>
          {block.items.map((item) => (
            <li key={item} className="pricing-detail__item">
              {item}
            </li>
          ))}
        </ListTag>
      );
    }
    case "terms":
      return (
        <dl className="pricing-detail__terms">
          {block.items.map(([term, description]) => (
            <div key={term} className="pricing-detail__term">
              <dt className="pricing-detail__term-name">{term}</dt>
              <dd className="pricing-detail__term-text">{description}</dd>
            </div>
          ))}
        </dl>
      );
    case "chips":
      return (
        <dl className="pricing-detail__groups">
          {block.groups.map(({ label, values }) => (
            <div key={label} className="pricing-detail__group">
              <dt className="pricing-detail__group-label">{label}</dt>
              <dd className="pricing-detail__chips">
                {values.map((value) => (
                  <span key={value} className="pricing-detail__chip">
                    {value}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      );
    case "calculation":
      return (
        <>
          <dl className="pricing-detail__calculation">
            {block.rows.map(([label, value]) => (
              <div key={label} className="pricing-detail__row">
                <dt>{label}</dt>
                <dd className="pricing-detail__value">{value}</dd>
              </div>
            ))}
            <div className="pricing-detail__row pricing-detail__row--total">
              <dt>{block.total[0]}</dt>
              <dd className="pricing-detail__value">{block.total[1]}</dd>
            </div>
          </dl>
          <p className="pricing-detail__note">{block.note}</p>
        </>
      );
  }
}
