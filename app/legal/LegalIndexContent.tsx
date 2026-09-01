"use client";

import Link from "next/link";
import LegalShell, { SellerIdentity } from "./LegalShell";
import { LegalLangProvider, useLegalLang } from "./legal-lang";

const copy = {
  fr: {
    kicker: "LÉGAL",
    title: "Légal",
    intro: "Cette section présente les documents juridiques et de consommation qui régissent l’achat et l’utilisation de Jonas Fitness Progress (« Progress »), un carnet d’entraînement numérique de force/musculation auto-dirigé proposé au prix unique de 19 € (Accès fondateur).",
    documents: [
      ["Confidentialité", " : comment nous traitons les données personnelles et quels processeurs sont impliqués."],
      ["Conditions d’utilisation", " : le produit, ce qu’il est et n’est pas, et l’accès fondateur."],
      ["Remboursements & rétractation", " : politique de remboursement / droits des consommateurs."],
    ],
    sellerLabel: "Le vendeur / exploitant légal de Jonas Fitness Progress est :",
    sellerBody: "Jonas Fitness est la marque/le produit. Le vendeur / exploitant légal est Younis MOHAMMAD, entrepreneur individuel. Riviera With Younis est une dénomination commerciale existante de la même entreprise individuelle ; il ne s’agit pas d’une société distincte. Jonas Fitness représente une activité supplémentaire de cette EI existante.",
    pubDirectorLabel: "Directeur de la publication",
    pubDirectorValue: "Younis MOHAMMAD, 104 Avenue Vauban, 83000 Toulon, France.",
    hostingLabel: "Hébergement / déploiement",
    hostingValue: "Vercel, hébergement et déploiement de https://jonas-fitness.jonascode.com.",
    governingLaw: "Droit applicable : le droit français s’applique à ces documents, sans limiter les droits impératifs des consommateurs dont vous pouvez bénéficier en vertu du droit de votre pays de résidence.",
    vat: "TVA : aucun numéro de TVA n’est actuellement affiché. Le traitement de la TVA suit les règles françaises applicables à l’activité du vendeur et sera mis à jour ici une fois confirmé.",
    adminStatusTitle: "État des démarches administratives",
    adminStatusIntro: "Les points suivants restent en cours et ne sont pas présentés comme aboutis ; ils font partie du suivi administratif du vendeur, distinct de l’exploitation technique du service :",
    adminRegistration: "Enregistrement d’activité supplémentaire (Guichet unique / RNE) : le dépôt relatif à l’activité supplémentaire numérique/logicielle de Jonas Fitness est en attente ; mise à jour administrative en cours, non présentée comme aboutie.",
    adminMediator: "Médiateur de la consommation : aucun médiateur de la consommation n’est actuellement désigné. Un médiateur de référence sera désigné et ses coordonnées publiées pour les litiges de consommation, comme l’exige le droit français de la consommation ; cette démarche est traitée en parallèle de la mise à jour administrative.",
    note: "Remarque : lorsque Stripe Managed Payments est utilisé, Stripe/Link agissent en qualité de commerçant de référence (merchant of record) pour la transaction de paiement. Les conditions de la transaction s’appliquent entre vous et Stripe/Link en tant qu’intermédiaire de paiement ; les conditions de Jonas Fitness ci-dessous décrivent le produit logiciel et le support que nous fournissons. Cela ne supprime pas nos propres obligations de support produit, de confidentialité, d’information du consommateur ou de protection des données.",
  },
  en: {
    kicker: "LEGAL",
    title: "Legal",
    intro: "This section lists the legal and consumer documents that govern the purchase and use of Jonas Fitness Progress (“Progress”), a self-directed strength/bodybuilding training log offered as a €19 one-time Founding Access.",
    documents: [
      ["Privacy", ": how we process personal data and which processors are involved."],
      ["Terms of use", ": the product, what it is and is not, and Founding Access."],
      ["Refunds & withdrawals", ": money-back / consumer-rights policy."],
    ],
    sellerLabel: "The legal seller / operator of Jonas Fitness Progress is:",
    sellerBody: "Jonas Fitness is the <strong>product/brand</strong>. The legal seller / operator is Younis MOHAMMAD, entrepreneur individuel. Riviera With Younis is an existing commercial name of the same enterprise individuelle; it is not a separate company. Jonas Fitness represents an additional activity of this existing EI.",
    pubDirectorLabel: "Publication director",
    pubDirectorValue: "Younis MOHAMMAD, 104 Avenue Vauban, 83000 Toulon, France.",
    hostingLabel: "Hosting / deployment",
    hostingValue: "Vercel, hosting and deployment of https://jonas-fitness.jonascode.com.",
    governingLaw: "Governing law: French law applies to these documents, without limiting the mandatory consumer-protection rights you may have under the law of your country of residence.",
    vat: "VAT: no VAT number is currently displayed. VAT treatment follows the applicable French rules for the seller’s activity and will be updated here when confirmed.",
    adminStatusTitle: "Status of administrative items",
    adminStatusIntro: "The following items remain outstanding and are <strong>not claimed as completed</strong>; they are part of the seller’s administrative follow-up, separate from the technical operation of the service:",
    adminRegistration: "Additional-activity registration (French Guichet unique / RNE): the filing for the Jonas Fitness additional digital/software activity is <strong>pending</strong>; an administrative update in progress, not claimed as completed.",
    adminMediator: "Consumer mediator: no consumer mediator is currently designated. A referenced mediator will be designated and its details published for consumer-mediation matters as required by French consumer law; this is being handled alongside the administrative update.",
    note: "Note: where Stripe Managed Payments is used, Stripe/Link act as merchant of record for the payment transaction. The transaction terms apply between you and Stripe/Link as the payment intermediary; Jonas Fitness’s own terms below describe the software product and support we provide. This does not remove our own product-support, privacy, consumer-information, or data-protection obligations.",
  },
  ar: {
    kicker: "قانوني",
    title: "قانوني",
    intro: "يعرض هذا القسم المستندات القانونية والمتعلقة بحقوق المستهلك التي تنظم شراء واستخدام Jonas Fitness Progress («بروغريس»)، سجل تدريب ذاتي التوجيه للقوة وكمال الأجسام يُقدَّم مقابل وصول تأسيسي لمرة واحدة بقيمة 19 €.",
    documents: [
      ["الخصوصية", ": كيف نعالج البيانات الشخصية والجهات المعالجة المعنية."],
      ["شروط الاستخدام", ": المنتج، ما هو وما ليس هو، وصول المؤسسين."],
      ["الاسترداد والانسحاب", ": سياسة استرداد الأموال وحقوق المستهلك."],
    ],
    sellerLabel: "البائع / المشغِّل القانوني لمنتج Jonas Fitness Progress هو:",
    sellerBody: "Jonas Fitness هي العلامة التجارية/المنتج. البائع / المشغِّل القانوني هو Younis MOHAMMAD، رائد أعمال فردي (entrepreneur individuel). Riviera With Younis هي تسمية تجارية قائمة لنفس المؤسسة الفردية؛ وهي ليست شركة منفصلة. تمثل Jonas Fitness نشاطًا إضافيًا لهذه المؤسسة الفردية القائمة.",
    pubDirectorLabel: "مدير النشر",
    pubDirectorValue: "Younis MOHAMMAD، 104 Avenue Vauban، 83000 تولون، فرنسا.",
    hostingLabel: "الاستضافة/النشر",
    hostingValue: "Vercel، استضافة ونشر https://jonas-fitness.jonascode.com.",
    governingLaw: "القانون الواجب التطبيق: يخضع هذا المستند للقانون الفرنسي، دون الإخلال بالحقوق الملزمة للمستهلك التي قد تتمتع بها بموجب قانون بلد إقامتك.",
    vat: "ضريبة القيمة المضافة (TVA): لا يوجد رقم ضريبة قيمة مضافة معروض حاليًا. يتبع تطبيق ضريبة القيمة المضافة القواعد الفرنسية المنطبقة على نشاط البائع، وسيُحدَّث هنا عند تأكيده.",
    adminStatusTitle: "حالة الإجراءات الإدارية",
    adminStatusIntro: "لا يزال البندان التاليان قيد التنفيذ ولا يُعرضان على أنهما مكتملان؛ فهما جزء من المتابعة الإدارية للبائع ومنفصلان عن التشغيل التقني للخدمة:",
    adminRegistration: "تسجيل النشاط الإضافي (الشباك الموحد / السجل الوطني للمنشآت RNE): الإيداع المتعلق بالنشاط الإضافي الرقمي/البرمجي لـ Jonas Fitness معلَّق؛ تحديث إداري قيد التنفيذ، ولم يُعلَن اكتماله.",
    adminMediator: "وسيط المستهلك: لا يوجد وسيط مستهلك معيّن حاليًا. سيتم تعيين وسيط مرجعي ونشر بياناته لمسائل الوساطة الاستهلاكية كما يقتضي القانون الفرنسي للاستهلاك؛ وتُعالَج هذه الخطوة بالتوازي مع التحديث الإداري.",
    note: "ملاحظة: عند استخدام Stripe Managed Payments، يعمل Stripe/Link بصفتهما التاجر المسجَّل (merchant of record) لمعاملة الدفع. تنطبق شروط المعاملة بينك وبين Stripe/Link بصفتهما وسيط الدفع؛ وتصف شروط Jonas Fitness أدناه المنتج البرمجي والدعم الذي نقدمه. لا يُلغي هذا التزاماتنا الخاصة بدعم المنتج والخصوصية وإعلام المستهلك وحماية البيانات.",
  },
} as const;

function LegalIndexBody() {
  const { lang } = useLegalLang();
  const t = copy[lang];
  return (
    <LegalShell kicker={t.kicker} title={t.title} updated="2026">
      <p>{t.intro}</p>

      <section>
        <h2>Documents</h2>
        <ul>
          <li><Link href="/legal/privacy">{t.documents[0][0]}</Link>{t.documents[0][1]}</li>
          <li><Link href="/legal/terms">{t.documents[1][0]}</Link>{t.documents[1][1]}</li>
          <li><Link href="/legal/refunds">{t.documents[2][0]}</Link>{t.documents[2][1]}</li>
        </ul>
      </section>

      <section>
        <h2>{t.sellerLabel}</h2>
        <SellerIdentity />
        <p>{t.sellerBody}</p>
        <ul>
          <li><strong>{t.pubDirectorLabel}:</strong> {t.pubDirectorValue}</li>
          <li><strong>{t.hostingLabel}:</strong> {t.hostingValue}</li>
          <li>{t.governingLaw}</li>
          <li>{t.vat}</li>
        </ul>
        <h3>{t.adminStatusTitle}</h3>
        <p>{t.adminStatusIntro}</p>
        <ul>
          <li>{t.adminRegistration}</li>
          <li>{t.adminMediator}</li>
        </ul>
      </section>

      <p>{t.note}</p>
    </LegalShell>
  );
}

export default function LegalIndexContent() {
  return (
    <LegalLangProvider>
      <LegalIndexBody />
    </LegalLangProvider>
  );
}