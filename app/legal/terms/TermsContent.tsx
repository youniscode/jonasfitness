"use client";

import LegalShell, { SellerIdentity } from "../LegalShell";
import { LegalLangProvider, useLegalLang } from "../legal-lang";

const copy = {
  fr: {
    kicker: "CONDITIONS",
    title: "Conditions d’utilisation",
    intro: "Les présentes conditions régissent le produit logiciel Jonas Fitness Progress (« Progress ») et l’achat unique de l’accès fondateur.",
    whatIs: "Ce qu’est Progress",
    whatIsText: "Progress est un <strong>logiciel d’entraînement auto-dirigé de force/musculation</strong>. Il fournit :",
    whatIsList: [
      "la gestion des routines d’entraînement et de leurs exercices ;",
      "l’enregistrement des séries, répétitions, charges (poids) et du RIR facultatif pour chaque série de travail ;",
      "un flux de progression <em>précédent → objectif → réel</em> pour comparer aujourd’hui à ce que vous avez fait la dernière fois ;",
      "des analyses de progression et d’historique (meilleures performances, tendances, volume, 1RM estimé le cas échéant).",
    ],
    whatNot: "Ce que Progress n’est pas",
    whatNotList: [
      "<strong>Pas un coaching 1:1</strong> — aucune relation de coaching professionnelle n’est créée.",
      "<strong>Pas un avis médical ni un diagnostic</strong> — Progress n’évalue, ne traite et ne prescrit rien pour les blessures, maladies ou états médicaux.",
      "<strong>Pas un service nutritionnel individualisé.</strong>",
      "<strong>Aucune garantie de résultats.</strong>",
      "<strong>Pas un entraîneur IA.</strong> Progress est un carnet d’entraînement transparent avec des analyses déterministes ; il ne génère pas de programmes et ne joue pas le rôle d’un entraîneur personnel automatisé.",
    ],
    founding: "Accès fondateur",
    foundingText: "Progress est proposé en <strong>accès fondateur unique</strong> (actuellement 19 €). Les clients fondateurs reçoivent l’accès au produit Progress actuel. De futurs produits ou services, facultatifs, pourront être vendus séparément. Il ne s’agit pas d’un abonnement (aucun prélèvement récurrent).",
    positioning: "Vendeur & positionnement du paiement",
    positioningText: "Lorsque Stripe Managed Payments est activé (commerçant de référence pour la transaction de paiement), Stripe/Link agissent en tant qu’intermédiaire de paiement pour cette transaction et traitent les données de paiement selon leurs propres conditions et politique de confidentialité. Nos conditions régissent le <em>produit et le support</em> Jonas Fitness Progress ; elles ne prétendent pas que Jonas Fitness perçoit/verse la TVA pour les transactions Managed Payments, et elles ne prétendent pas que Managed Payments supprime nos propres obligations juridiques, de confidentialité, de support produit, d’information du consommateur ou de protection des données.",
    positioningText2: "Si des Stripe Payments ordinaires (non gérés) sont utilisés à la place, le traitement fiscal/de conformité applicable — y compris les éventuelles obligations de TVA / taxes indirectes — relève de notre responsabilité ; les modalités précises ne sont pas encore confirmées, et aucun numéro de TVA n’est revendiqué dans les présentes conditions.",
    seller: "Vendeur / identité juridique",
    sellerLabel: "Le vendeur / exploitant légal de Jonas Fitness Progress est :",
    sellerBody: "Jonas Fitness est la marque/le produit ; le vendeur / exploitant légal est Younis MOHAMMAD, entrepreneur individuel. Riviera With Younis est une dénomination commerciale existante de la même entreprise individuelle. Jonas Fitness est une activité supplémentaire de cette EI existante.",
    items: [
      "Droit applicable / juridiction compétente : le droit français régit les présentes conditions. Rien dans celles-ci ne limite les droits impératifs des consommateurs dont vous pouvez bénéficier en vertu du droit de votre pays de résidence, y compris le droit de saisir les tribunaux de votre lieu de résidence lorsque le droit applicable le prévoit.",
      "Enregistrement d’activité supplémentaire (Guichet unique / RNE) : le dépôt relatif à l’activité supplémentaire numérique/logicielle de Jonas Fitness est en attente — mise à jour administrative en cours, non présentée comme aboutie.",
      "Médiateur de la consommation : aucun médiateur de la consommation n’est actuellement désigné ; la désignation et la publication des coordonnées d’un médiateur de référence pour les litiges de consommation sont en attente.",
      "TVA : aucun numéro de TVA n’est actuellement affiché. Le traitement de la TVA suit les règles françaises applicables à l’activité du vendeur et sera mis à jour ici une fois confirmé.",
    ],
    acceptance: "Acceptation & disponibilité",
    acceptanceText: "En achetant l’accès fondateur ou en utilisant Progress, vous acceptez les présentes conditions. Celles-ci n’excluent pas les droits impératifs dont vous bénéficiez en tant que consommateur.",
  },
  en: {
    kicker: "TERMS",
    title: "Terms of use",
    intro: "These terms govern the Jonas Fitness Progress (“Progress”) software product and the one-time Founding Access purchase.",
    whatIs: "What Progress is",
    whatIsText: "Progress is <strong>self-directed strength/bodybuilding training software</strong>. It provides:",
    whatIsList: [
      "workout routines and routine management;",
      "recording of sets, reps, load (weight) and optional RIR for each working set;",
      "a <em>previous → target → actual</em> progression workflow so you can compare today against what you did last time;",
      "progress and history analytics (best performances, trends, volume, estimated 1RM where appropriate).",
    ],
    whatNot: "What Progress is not",
    whatNotList: [
      "<strong>Not 1:1 coaching</strong> — no professional coaching relationship is formed.",
      "<strong>Not medical advice or diagnosis</strong> — Progress does not assess, treat, or prescribe for injuries, illnesses, or medical conditions.",
      "<strong>Not an individualized nutrition service.</strong>",
      "<strong>No guaranteed fitness results.</strong>",
      "<strong>Not an AI trainer.</strong> Progress is a transparent training log with deterministic analytics; it does not generate programs or act as an automated personal trainer.",
    ],
    founding: "Founding Access",
    foundingText: "Progress is offered as a <strong>one-time Founding Access</strong> (currently €19). Founding customers receive access to the current Progress product. Future, optional products or services may be sold separately. This is not a subscription (no recurring billing).",
    positioning: "Seller & payment positioning",
    positioningText: "Where Stripe Managed Payments is enabled (merchant of record for the payment transaction), Stripe/Link act as the payment intermediary for that transaction and process payment data under their own terms and privacy policy. Our terms govern the Jonas Fitness Progress <em>product and support</em>; they do not claim that Jonas Fitness collects/remits VAT for Managed Payments transactions, and they do not claim Managed Payments removes our own legal, privacy, product-support, consumer-information, or data-protection obligations.",
    positioningText2: "Where ordinary Stripe Payments (non-managed) is used instead, the applicable tax/compliance treatment — including any VAT/indirect-tax obligations — is our responsibility; the specifics are not yet confirmed, and no VAT number is claimed in these terms.",
    seller: "Seller / legal identity",
    sellerLabel: "The legal seller / operator of Jonas Fitness Progress is:",
    sellerBody: "Jonas Fitness is the <strong>product/brand</strong>; the legal seller / operator is Younis MOHAMMAD, entrepreneur individuel. Riviera With Younis is an existing commercial name of the same enterprise individuelle. Jonas Fitness is an additional activity of this existing EI.",
    items: [
      "Governing law / competent jurisdiction: French law applies to these terms. Nothing in them limits the mandatory consumer-protection rights you may have under the law of your country of residence, including the right to bring a dispute before the courts of your place of residence where applicable law grants it.",
      "Additional-activity registration (French Guichet unique / RNE): the filing for the Jonas Fitness additional digital/software activity is <strong>pending</strong> — an administrative update in progress, not claimed as completed.",
      "Consumer mediator: no consumer mediator is currently designated; designation and publication of a referenced mediator’s details for consumer-mediation matters are pending.",
      "VAT: no VAT number is currently displayed. VAT treatment follows the applicable French rules for the seller’s activity and will be updated here when confirmed.",
    ],
    acceptance: "Acceptance & availability",
    acceptanceText: "By purchasing Founding Access or using Progress, you accept these terms. These terms do not exclude the mandatory rights you have under consumer law.",
  },
  ar: {
    kicker: "الشروط",
    title: "شروط الاستخدام",
    intro: "تنظم هذه الشروط المنتج البرمجي Jonas Fitness Progress («بروغريس») وشراء الوصول التأسيسي لمرة واحدة.",
    whatIs: "ما هو بروغريس",
    whatIsText: "Progress هو <strong>برنامج تدريب ذاتي التوجيه للقوة وكمال الأجسام</strong>. يوفّر:",
    whatIsList: [
      "إدارة روتينات التمارين وتمارينها؛",
      "تسجيل المجموعات والتكرارات والأوزان وRIR الاختياري لكل مجموعة عمل؛",
      "سير عمل تقدم <em>السابق ← الهدف ← الفعلي</em> لمقارنة اليوم بما فعلته آخر مرة؛",
      "تحليلات التقدم والسجل (أفضل الأداءات والاتجاهات والحجم وتقدير 1RM عند الاقتضاء).",
    ],
    whatNot: "ما ليس هو",
    whatNotList: [
      "<strong>ليس تدريبًا فرديًا 1:1</strong> — لا تُنشأ أي علاقة تدريب احترافية.",
      "<strong>ليس نصيحة طبية ولا تشخيصًا</strong> — لا يقيّم Progress الإصابات أو الأمراض أو الحالات الطبية ولا يعالجها ولا يصف لها.",
      "<strong>ليست خدمة تغذية فردية.</strong>",
      "<strong>لا ضمان لنتائج اللياقة.</strong>",
      "<strong>ليس مدربًا بالذكاء الاصطناعي.</strong> Progress سجل تدريب شفاف بتحليلات حتمية؛ لا يولّد البرامج ولا يعمل كمدرب شخصي آلي.",
    ],
    founding: "الوصول التأسيسي",
    foundingText: "يُقدَّم Progress كـ<strong>وصول تأسيسي لمرة واحدة</strong> (حاليًا 19 €). يحصل العملاء المؤسسون على الوصول إلى منتج Progress الحالي. قد تُباع منتجات أو خدمات مستقبلية اختيارية بشكل منفصل. هذا ليس اشتراكًا (لا فوترة متكررة).",
    positioning: "البائع وموقف الدفع",
    positioningText: "عند تفعيل Stripe Managed Payments (التاجر المسجَّل لمعاملة الدفع)، يعمل Stripe/Link كوسيط دفع لتلك المعاملة ويعالجون بيانات الدفع وفق شروطهم وسياسة الخصوصية الخاصة بهم. تحكم شروطنا <em>المنتج والدعم</em> الخاصين بـ Jonas Fitness Progress؛ ولا تدّعي أن Jonas Fitness يتحصل/يحوّل ضريبة القيمة المضافة لمعاملات Managed Payments، ولا تدّعي أن Managed Payments يلغي التزاماتنا القانونية وبالخصوصية ودعم المنتج وإعلام المستهلك وحماية البيانات.",
    positioningText2: "إذا استُخدمت Stripe Payments عادية (غير مُدارة) بدلاً من ذلك، فإن المعالجة الضريبية/الامتثال المطبقة — بما في ذلك أي التزامات تتعلق بضريبة القيمة المضافة/الضرائب غير المباشرة — تقع على عاتقنا؛ لم يتم تأكيد التفاصيل بعد، ولا يُدّعى أي رقم ضريبة قيمة مضافة في هذه الشروط.",
    seller: "البائع / الهوية القانونية",
    sellerLabel: "البائع / المشغِّل القانوني لمنتج Jonas Fitness Progress هو:",
    sellerBody: "Jonas Fitness هي العلامة التجارية/المنتج؛ البائع / المشغِّل القانوني هو Younis MOHAMMAD، رائد أعمال فردي (entrepreneur individuel). Riviera With Younis هي تسمية تجارية قائمة لنفس المؤسسة الفردية. Jonas Fitness نشاط إضافي لهذه المؤسسة الفردية القائمة.",
    items: [
      "القانون الواجب التطبيق / الاختصاص القضائي: يخضع هذا المستند للقانون الفرنسي. لا يحدّ منه شيئًا الحقوق الملزمة للمستهلك التي قد تتمتع بها بموجب قانون بلد إقامتك، بما في ذلك حق رفع نزاع أمام محاكم مكان إقامتك عندما يمنحه القانون الواجب التطبيق.",
      "تسجيل النشاط الإضافي (الشباك الموحد / السجل الوطني للمنشآت RNE): الإيداع المتعلق بالنشاط الإضافي الرقمي/البرمجي لـ Jonas Fitness معلَّق — تحديث إداري قيد التنفيذ، ولم يُعلَن اكتماله.",
      "وسيط المستهلك: لا يوجد وسيط مستهلك معيّن حاليًا؛ تعيين ونشر بيانات وسيط مرجعي لمسائل الوساطة الاستهلاكية قيد الانتظار.",
      "ضريبة القيمة المضافة (TVA): لا يوجد رقم ضريبة قيمة مضافة معروض حاليًا. يتبع تطبيق ضريبة القيمة المضافة القواعد الفرنسية المنطبقة على نشاط البائع وسيُحدَّث هنا عند تأكيده.",
    ],
    acceptance: "القبول والتوافر",
    acceptanceText: "بشرائك الوصول التأسيسي أو استخدامك Progress، فإنك تقبل هذه الشروط. لا تستبعد هذه الشروط الحقوق الملزمة التي تتمتع بها بموجب قانون المستهلك.",
  },
} as const;

function TermsBody() {
  const { lang } = useLegalLang();
  const t = copy[lang];
  return (
    <LegalShell kicker={t.kicker} title={t.title} updated="2026">
      <p>{t.intro}</p>

      <section>
        <h2>{t.whatIs}</h2>
        <p>{t.whatIsText}</p>
        <ul>
          {t.whatIsList.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
      </section>

      <section>
        <h2>{t.whatNot}</h2>
        <ul>
          {t.whatNotList.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
      </section>

      <section>
        <h2>{t.founding}</h2>
        <p dangerouslySetInnerHTML={{ __html: t.foundingText }} />
      </section>

      <section>
        <h2>{t.positioning}</h2>
        <p>{t.positioningText}</p>
        <p>{t.positioningText2}</p>
      </section>

      <section>
        <h2>{t.seller}</h2>
        <p>{t.sellerLabel}</p>
        <SellerIdentity />
        <p dangerouslySetInnerHTML={{ __html: t.sellerBody }} />
        <ul>
          {t.items.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
      </section>

      <section>
        <h2>{t.acceptance}</h2>
        <p>{t.acceptanceText}</p>
      </section>
    </LegalShell>
  );
}

export default function TermsContent() {
  return (
    <LegalLangProvider>
      <TermsBody />
    </LegalLangProvider>
  );
}