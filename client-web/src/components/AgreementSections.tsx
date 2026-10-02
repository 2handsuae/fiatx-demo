// 战役丙波三 T7 · 协议正文分节渲染——注册页抽屉与 /agreement 阅读页共用的唯一渲染路径。
// markup 逐字取自 CustomerRegister.tsx TermsDrawer 原 section 循环；返回 Fragment 而非自带容器，
// 这样抽屉里它与"End of document"落款仍是同一个 space-y-12 容器的直接子节点，间距像素不变。
import type { AgreementSection } from '../utils/agreementView';

const AgreementSections = ({ sections }: { sections: AgreementSection[] }) => (
  <>
    {sections.map((section) => (
      <section
        key={section.no}
        data-section={section.no}
        className="scroll-mt-6"
      >
        <div className="flex items-baseline gap-6 mb-6 pb-4 border-b border-fx-rule">
          <span className="fx-display font-light text-[40px] leading-none text-fx-brass/60 tabular-nums">
            {section.no}
          </span>
          <h3 className="fx-display text-[22px] leading-tight text-fx-sand">
            {section.title}
          </h3>
        </div>
        <div className="space-y-5">
          {section.body.map((para, i) => (
            <p
              key={i}
              className="fx-serif text-[15px] leading-[1.75] text-fx-dune"
            >
              {para}
            </p>
          ))}
        </div>
      </section>
    ))}
  </>
);

export default AgreementSections;
