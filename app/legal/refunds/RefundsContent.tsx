"use client";

import LegalShell, { SellerIdentity } from "../LegalShell";
import { LegalLangProvider, useLegalLang } from "../legal-lang";

const copy = {
  fr: {
    kicker: "REMBOURSEMENTS",
    title: "Remboursements & rétractation",
    intro: "Cette page décrit notre approche en matière de remboursement et de rétractation du consommateur pour l’accès à Jonas Fitness Progress.",
    policy: "Politique de remboursement (conservatrice et favorable au client)",
    policyList: [
      "Si vous changez d’avis avant de commencer à utiliser Progress, vous pouvez demander un remboursement.",
      "Si vous n’êtes pas satisfait dans les <strong>14 jours</strong> suivant votre achat, vous pouvez demander un remboursement et votre accès Progress sera révoqué.",
      "Un remboursement intégral confirmé sur votre commande entraîne la révocation du droit d’accès Progress correspondant (l’accès est retiré ; les journaux d’entraînement que vous avez créés sont conservés mais ne sont plus accessibles via le produit payant).",
      "Les remboursements partiels ne révoquent pas l’accès.",
    ],
    withdrawal: "Rétractation : contenus/services numériques (UE)",
    withdrawalText: "Les règles européennes de consommation prévoient que le droit de rétractation de 14 jours peut, dans certains cas, être exclu ou modifié pour les contenus/services numériques <strong>uniquement si</strong> le professionnel obtient de la part du consommateur une reconnaissance et un consentement exprès et préalables avant le début de la fourniture. Nous ne nous appuyons <strong>pas</strong> actuellement sur une telle exception : aucun consentement/reconnaissance exprès au paiement n’existe aujourd’hui, et nous ne prétendons donc pas à une perte automatique du droit de rétractation. La politique de remboursement ci-dessus s’applique donc.",
    howTo: "Comment demander un remboursement",
    howToList: [
      "<strong>Contact pour les demandes de remboursement :</strong> <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a>",
      "<strong>Délai de traitement :</strong> nous visons à traiter les remboursements approuvés dans les 14 jours suivant l’approbation.",
      "<strong>Modalité de remboursement :</strong> vers le moyen de paiement d’origine, via Stripe.",
    ],
    note: "Remarque : lorsque Stripe Managed Payments s’applique, Stripe/Link traitent les transactions de paiement en tant que commerçant de référence. Cela ne prime pas sur notre politique de remboursement déclarée pour le produit Progress.",
    addressee: "Destinataire du remboursement & statut",
    addresseeLabel: "Les remboursements relèvent de la responsabilité du vendeur légal :",
    statusList: [
      "<strong>Enregistrement d’activité supplémentaire (Guichet unique / RNE) :</strong> le dépôt relatif à l’activité supplémentaire numérique/logicielle de Jonas Fitness est en attente ; mise à jour administrative en cours, non présentée comme aboutie.",
      "<strong>Médiateur de la consommation :</strong> aucun médiateur de la consommation n’est actuellement désigné ; la désignation et la publication des coordonnées d’un médiateur de référence pour les litiges de consommation sont en attente.",
      "<strong>Droit applicable :</strong> le droit français s’applique aux remboursements, sans limiter les droits impératifs des consommateurs dont vous pouvez bénéficier en vertu du droit de votre pays de résidence.",
    ],
  },
  en: {
    kicker: "REFUNDS",
    title: "Refunds & withdrawals",
    intro: "This page describes our refund and consumer-withdrawal approach for access to Jonas Fitness Progress.",
    policy: "Refund policy (conservative & customer-friendly)",
    policyList: [
      "If you change your mind before you begin using Progress, you may request a refund.",
      "If you are not satisfied within <strong>14 days</strong> of your purchase, you may request a refund and your Progress access will be revoked.",
      "A confirmed full refund on your order results in the revocation of the corresponding Progress access entitlement (access is withdrawn; training logs you created are preserved but no longer accessible under the paid product).",
      "Partial refunds do not revoke access.",
    ],
    withdrawal: "EU digital-content / digital-service withdrawal",
    withdrawalText: "EU consumer rules provide that the 14-day withdrawal right can, in some cases, be excluded or modified for digital content/services <strong>only if</strong> the trader obtains the consumer’s express, prior acknowledgement and consent before supply starts. We do <strong>not</strong> currently rely on such an exception: no express checkout consent/acknowledgement exists today, so we do not claim automatic loss of withdrawal rights. The refund policy above therefore applies.",
    howTo: "How to request a refund",
    howToList: [
      "<strong>Refund request contact:</strong> <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a>",
      "<strong>Refund processing time:</strong> we aim to process approved refunds within 14 days of approval.",
      "<strong>Refund method:</strong> to the original payment method, via Stripe.",
    ],
    note: "Note: where Stripe Managed Payments applies, Stripe/Link process payment transactions as merchant of record. This does not override our stated refund policy for the Progress product.",
    addressee: "Refund addressee & status",
    addresseeLabel: "Refunds are the responsibility of the legal seller:",
    statusList: [
      "<strong>Additional-activity registration (French Guichet unique / RNE):</strong> the filing for the Jonas Fitness additional digital/software activity is <strong>pending</strong>; an administrative update in progress, not claimed as completed.",
      "<strong>Consumer mediator:</strong> no consumer mediator is currently designated; designation and publication of a referenced mediator’s details for consumer-mediation matters are pending.",
      "<strong>Governing law:</strong> French law applies to refunds, without limiting the mandatory consumer-protection rights you may have under the law of your country of residence.",
    ],
  },
  ar: {
    kicker: "الاسترداد",
    title: "الاسترداد والانسحاب",
    intro: "تصف هذه الصفحة نهجنا في الاسترداد وانصراف المستهلك الخاص بالوصول إلى Jonas Fitness Progress.",
    policy: "سياسة الاسترداد (تحفظية ومراعية للعميل)",
    policyList: [
      "إذا غيّرت رأيك قبل بدء استخدام Progress، يمكنك طلب استرداد المبلغ.",
      "إذا لم تكن راضيًا خلال <strong>14 يومًا</strong> من شرائك، يمكنك طلب استرداد المبلغ وسيُلغى وصولك إلى Progress.",
      "يؤدي استرداد كامل مؤكد على طلبك إلى إلغاء حق الوصول المقابل إلى Progress (يُسحب الوصول؛ وتُحتفظ بسجلات التدريب التي أنشأتها لكنها لن تكون متاحة بعد الآن ضمن المنتج المدفوع).",
      "الاستردادات الجزئية لا تلغي الوصول.",
    ],
    withdrawal: "الانسحاب: المحتوى/الخدمات الرقمية (الاتحاد الأوروبي)",
    withdrawalText: "تنص قواعد المستهلك الأوروبية على أن حق الانسحاب خلال 14 يومًا يمكن، في بعض الحالات، استبعاده أو تعديله للمحتوى/الخدمات الرقمية <strong>فقط إذا</strong> حصل التاجر على إقرار وموافقة صريحين وسابقين من المستهلك قبل بدء التوريد. نحن لا نعتمد حاليًا على مثل هذا الاستثناء: لا يوجد إقرار/موافقة صريحان عند الدفع اليوم، لذا لا ندّعي فقدانًا تلقائيًا لحق الانسحاب. وبالتالي تنطبق سياسة الاسترداد أعلاه.",
    howTo: "كيف تطلب استردادًا",
    howToList: [
      "<strong>جهة الاتصال لطلبات الاسترداد:</strong> <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a>",
      "<strong>مدة المعالجة:</strong> نهدف إلى معالجة الاستردادات المعتمدة خلال 14 يومًا من الموافقة.",
      "<strong>طريقة الاسترداد:</strong> إلى وسيلة الدفع الأصلية، عبر Stripe.",
    ],
    note: "ملاحظة: عند انطباق Stripe Managed Payments، يعالج Stripe/Link معاملات الدفع كتاجر مسجَّل. لا يتجاوز هذا سياسة الاسترداد المعلنة لدينا لمنتج Progress.",
    addressee: "جهة الاسترداد والحالة",
    addresseeLabel: "تقع مسؤولية الاستردادات على البائع القانوني:",
    statusList: [
      "<strong>تسجيل النشاط الإضافي (الشباك الموحد / السجل الوطني للمنشآت RNE):</strong> الإيداع المتعلق بالنشاط الإضافي الرقمي/البرمجي لـ Jonas Fitness معلَّق؛ تحديث إداري قيد التنفيذ، ولم يُعلَن اكتماله.",
      "<strong>وسيط المستهلك:</strong> لا يوجد وسيط مستهلك معيّن حاليًا؛ تعيين ونشر بيانات وسيط مرجعي لمسائل الوساطة الاستهلاكية قيد الانتظار.",
      "<strong>القانون الواجب التطبيق:</strong> يخضع الاسترداد للقانون الفرنسي، دون الإخلال بالحقوق الملزمة للمستهلك التي قد تتمتع بها بموجب قانون بلد إقامتك.",
    ],
  },
} as const;

function RefundsBody() {
  const { lang } = useLegalLang();
  const t = copy[lang];
  return (
    <LegalShell kicker={t.kicker} title={t.title} updated="2026">
      <p>{t.intro}</p>

      <section>
        <h2>{t.policy}</h2>
        <ul>
          {t.policyList.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
      </section>

      <section>
        <h2>{t.withdrawal}</h2>
        <p dangerouslySetInnerHTML={{ __html: t.withdrawalText }} />
      </section>

      <section>
        <h2>{t.howTo}</h2>
        <ul>
          {t.howToList.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
        <p>{t.note}</p>
      </section>


      <section>
        <h2>{t.addressee}</h2>
        <p>{t.addresseeLabel}</p>
        <SellerIdentity />
        <ul>
          {t.statusList.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
      </section>
    </LegalShell>
  );
}

export default function RefundsContent() {
  return (
    <LegalLangProvider>
      <RefundsBody />
    </LegalLangProvider>
  );
}