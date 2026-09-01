"use client";

import LegalShell, { SellerIdentity } from "../LegalShell";
import { LegalLangProvider, useLegalLang } from "../legal-lang";

const copy = {
  fr: {
    kicker: "CONFIDENTIALITÉ",
    title: "Confidentialité",
    intro: "Cette page décrit les données personnelles traitées dans le cadre de Jonas Fitness Progress (« Progress ») et les processeurs que nous utilisons. Elle recense ce qui existe réellement dans le produit aujourd’hui et expose la politique applicable en matière de conservation et de base légale, sans inventer de durées ni de fonctionnalités.",
    whatWeProcess: "Ce que nous traitons",
    processList: [
      "Identité du compte (via Clerk) : identité du compte Clerk, e-mail, identifiant utilisateur et données de connexion/session.",
      "Données d’entraînement (stockées par l’application) : routines d’entraînement, exercices, séries/répétitions/charge/RIR, objectifs et historique des exercices/séances.",
      "Données d’achat & de droit d’accès : identifiants de commande/paiement, droit d’accès au produit et son statut (actif/révoqué), horodatages.",
      "Événements internes de validation : événements de parcours tels que offre consultée, paiement commencé, achat terminé, première routine créée, première séance démarrée/terminée.",
      "Journaux techniques : journaux serveur et sorties d’erreur/diagnostic produites par les plateformes ci-dessous.",
    ],
    noDataLine: "Nous ne collectons aucune donnée biométrique, de diagnostic de santé ou médicale. Les journaux d’entraînement sont des enregistrements d’exercice, pas des informations médicales.",
    processors: "Processeurs / services réellement utilisés",
    processorList: [
      "Clerk — authentification/identité (création de compte, connexion, données de profil utilisateur).",
      "Neon — stockage de base de données Postgres des données d’entraînement, d’achat/droit d’accès et de validation.",
      "Vercel — hébergement et infrastructure de l’application.",
      "Stripe / Link — traitement des paiements. Lorsque Stripe Managed Payments est utilisé (commerçant de référence pour la transaction), Stripe/Link traitent les données de paiement (ex. moyen de paiement et détails de transaction) directement selon leurs propres conditions et politique de confidentialité.",
    ],
    stripeVsUs: "Les données de moyen de paiement (données de carte, identifiants Link, etc.) sont collectées et traitées par Stripe/Link, et ne sont pas stockées par nous. Nous stockons les références de commande/paiement (identifiants de session/paiement) nécessaires pour rapprocher et accorder votre droit d’accès, mais jamais les données complètes de carte. Lorsque Managed Payments s’applique, Stripe/Link agissent en qualité de commerçant de référence pour la transaction de paiement.",
    retention: "Conservation",
    retentionList: [
      "Données de compte et d’entraînement : conservées tant que votre compte reste actif.",
      "Enregistrements d’achat / droit d’accès / validation : conservés tant que nécessaire pour les obligations légales du vendeur (y compris fiscales et comptables) et pour vérifier les droits d’accès.",
      "Journaux techniques : conservés pendant la durée limitée nécessaire à la sécurité, la fiabilité et la résolution des problèmes.",
      "Suppression / export : Progress ne propose actuellement pas d’export de données en libre-service dans l’application. Pour demander la suppression ou une copie de vos données, contactez <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a> ; les demandes sont traitées conformément au droit applicable.",
    ],
    status: "Statut",
    statusText: "Jonas Fitness est une <strong>activité supplémentaire numérique/logicielle</strong> de l’entreprise existante du vendeur. Le dépôt de cette activité supplémentaire auprès de l’administration française (Guichet unique / RNE) est <strong>en attente</strong> — mise à jour administrative en cours, non présentée comme aboutie.",
    legalBasis: "Base légale & droits",
    controllerLabel: "Le responsable du traitement des données personnelles de Progress est le vendeur légal :",
    basesIntro: "Lorsque le droit européen/UK de la protection des données s’applique, nous nous appuyons sur les bases légales suivantes :",
    basesList: [
      "la fourniture du service et le stockage de vos données d’entraînement : l’exécution du contrat conclu avec vous (article 6, paragraphe 1, point b) du RGPD) ;",
      "les enregistrements d’achat / droit d’accès / validation : l’exécution du contrat et, pour les enregistrements fiscaux et comptables, le respect d’une obligation légale (article 6, paragraphe 1, point c) du RGPD) ;",
      "les journaux techniques et les mesures de sécurité / anti-fraude : notre intérêt légitime à exploiter un service sûr et fiable (article 6, paragraphe 1, point f) du RGPD).",
    ],
    rights: "Vous disposez des droits d’accès, de rectification, d’effacement, de limitation, de portabilité et d’opposition lorsque les conditions légales sont remplies. Pour toute demande de confidentialité, contactez <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a>.",
    transfers: "Transferts internationaux",
    transfersText: "Certains de nos processeurs (Clerk, Stripe, Vercel, Neon) peuvent traiter des données sur des infrastructures situées hors de l’EEE. Lorsque des transferts hors de l’EEE ont lieu, nous nous appuyons sur les garanties offertes par les processeurs concernés, y compris, le cas échéant, les clauses contractuelles types de la Commission européenne.",
  },
  en: {
    kicker: "PRIVACY",
    title: "Privacy",
    intro: "This page describes the personal data handled in relation to Jonas Fitness Progress (“Progress”) and the processors we use. It inventories what actually exists in the product today and states the applicable retention and legal-basis policy, without inventing periods or features.",
    whatWeProcess: "What we process",
    processList: [
      "<strong>Account identity (via Clerk):</strong> Clerk account identity, email, user ID, and sign-in/session data.",
      "<strong>Training data (stored by the app):</strong> workout routines, exercises, sets/reps/load/RIR, targets, and exercise/workout history.",
      "<strong>Purchase &amp; entitlement data:</strong> order/payment identifiers, product entitlement and its status (active/revoked), timestamps.",
      "<strong>First-party validation events:</strong> funnel events such as offer viewed, checkout started, purchase completed, first routine created, first workout started/completed.",
      "<strong>Technical logs:</strong> server logs and error/diagnostic output produced by the platforms below.",
    ],
    noDataLine: "We do not collect any biometric, health-diagnosis, or medical data. Training logs are exercise records, not medical information.",
    processors: "Processors / services actually used",
    processorList: [
      "<strong>Clerk</strong> — authentication/identity (account creation, sign-in, user profile data).",
      "<strong>Neon</strong> — Postgres database storage of training, purchase/entitlement, and validation data.",
      "<strong>Vercel</strong> — application hosting and infrastructure.",
      "<strong>Stripe / Link</strong> — payment processing. Where Stripe Managed Payments is used (merchant-of-record for the transaction), Stripe/Link process payment data (e.g. payment method and transaction details) directly under their own terms and privacy policy.",
    ],
    stripeVsUs: "Payment method data (card details, Link credentials, etc.) is collected and processed by Stripe/Link, not stored by us. We store order/payment references (session/payment identifiers) needed to reconcile and grant your entitlement, but never full card data. Where Managed Payments applies, Stripe/Link act as merchant of record for the payment transaction.",
    retention: "Retention",
    retentionList: [
      "<strong>Account and training data:</strong> retained for as long as your account remains active.",
      "<strong>Purchase / entitlement / validation records:</strong> retained for as long as needed for the seller’s legal obligations (including tax and accounting) and to verify entitlements.",
      "<strong>Technical logs:</strong> retained for the limited period needed for security, reliability, and troubleshooting.",
      "<strong>Deletion / export:</strong> Progress does not currently offer an in-app self-service data export. To request deletion or a copy of your data, contact <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a>; requests are processed in accordance with applicable law.",
    ],
    status: "Status",
    statusText: "Jonas Fitness is an <strong>additional digital/software activity</strong> of the legal seller’s existing enterprise. The filing of this additional activity with the French administration (Guichet unique / RNE) is <strong>pending</strong> — an administrative update in progress, not claimed as completed.",
    legalBasis: "Legal basis & rights",
    controllerLabel: "The data controller for Progress personal data is the legal seller:",
    basesIntro: "Where EU/UK data-protection law applies, we rely on the following legal bases:",
    basesList: [
      "providing the service and storing your training data: performance of the contract with you (Article 6(1)(b) GDPR);",
      "purchase / entitlement / validation records: performance of the contract and, for tax- and accounting-related records, compliance with a legal obligation (Article 6(1)(c) GDPR);",
      "technical logs and security / anti-fraud measures: our legitimate interest in operating a secure and reliable service (Article 6(1)(f) GDPR).",
    ],
    rights: "You have the rights of access, rectification, erasure, restriction, portability, and objection where the legal conditions are met. For any privacy request, contact <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a>.",
    transfers: "International transfers",
    transfersText: "Some of our processors (Clerk, Stripe, Vercel, Neon) may process data on infrastructure located outside the EEA. Where transfers outside the EEA occur, we rely on the safeguards offered by the processors concerned, including the European Commission’s standard contractual clauses where applicable.",
  },
  ar: {
    kicker: "الخصوصية",
    title: "الخصوصية",
    intro: "تصف هذه الصفحة البيانات الشخصية التي نتعامل معها فيما يتعلق بمنتج Jonas Fitness Progress («بروغريس») والجهات المعالجة التي نستخدمها. وهي تُحصي ما هو موجود فعليًا في المنتج اليوم وتوضح سياسة الاحتفاظ والأساس القانوني المطبقة، دون اختلاق فترات أو ميزات.",
    whatWeProcess: "ما نعالجه",
    processList: [
      "<strong>هوية الحساب (عبر Clerk):</strong> هوية حساب Clerk والبريد الإلكتروني ومعرف المستخدم وبيانات تسجيل الدخول/الجلسة.",
      "<strong>بيانات التدريب (مخزنة في التطبيق):</strong> روتينات التمارين والتمارين والمجموعات/التكرارات/الأوزان/RIR والأهداف وسجل التمارين/الحصص.",
      "<strong>بيانات الشراء والوصول:</strong> معرّفات الطلب/الدفع وحق الوصول إلى المنتج وحالته (نشط/ملغى) والطوابع الزمنية.",
      "<strong>أحداث التحقق الداخلية:</strong> أحداث مسار مثل عرض العرض، بدء الدفع، اكتمال الشراء، إنشاء أول روتين، بدء/إنهاء أول حصة.",
      "<strong>السجلات التقنية:</strong> سجلات الخادم ومخرجات الأخطاء/التشخيص الناتجة عن المنصات أدناه.",
    ],
    noDataLine: "لا نجمع أي بيانات بيومترية أو تشخيصية صحية أو طبية. سجلات التدريب هي سجلات تمارين وليست معلومات طبية.",
    processors: "الجهات المعالجة / الخدمات المستخدمة فعليًا",
    processorList: [
      "<strong>Clerk</strong> — المصادقة/الهوية (إنشاء الحساب، تسجيل الدخول، بيانات الملف الشخصي).",
      "<strong>Neon</strong> — تخزين قاعدة بيانات Postgres لبيانات التدريب والشراء/الوصول والتحقق.",
      "<strong>Vercel</strong> — استضافة التطبيق والبنية التحتية.",
      "<strong>Stripe / Link</strong> — معالجة الدفع. عند استخدام Stripe Managed Payments (التاجر المسجَّل للمعاملة)، يعالج Stripe/Link بيانات الدفع (مثل وسيلة الدفع وتفاصيل المعاملة) مباشرة وفق شروطهم وسياسة الخصوصية الخاصة بهم.",
    ],
    stripeVsUs: "يتم جمع ومعالجة بيانات وسيلة الدفع (تفاصيل البطاقة، بيانات اعتماد Link، إلخ) بواسطة Stripe/Link، ولا نخزّنها نحن. نخزّن مراجع الطلب/الدفع (معرّفات الجلسة/الدفع) اللازمة لمطابقة حق الوصول ومنحه، ولكن لا نخزّن أبدًا بيانات البطاقة الكاملة. عندما ينطبق Managed Payments، يعمل Stripe/Link كتاجر مسجَّل لمعاملة الدفع.",
    retention: "الاحتفاظ",
    retentionList: [
      "<strong>بيانات الحساب والتدريب:</strong> تُحتفظ بها طالما ظل حسابك نشطًا.",
      "<strong>سجلات الشراء/الوصول/التحقق:</strong> تُحتفظ بها للمدة اللازمة للالتزامات القانونية للبائع (بما في ذلك الضرائب والمحاسبة) وللتحقق من حقوق الوصول.",
      "<strong>السجلات التقنية:</strong> تُحتفظ بها للمدة المحدودة اللازمة للأمن والموثوقية واستكشاف الأخطاء.",
      "<strong>الحذف/التصدير:</strong> لا يوفّر Progress حاليًا تصدير بيانات ذاتي داخل التطبيق. لطلب حذف بياناتك أو نسخة منها، تواصل مع <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a>؛ وتُعالَج الطلبات وفقًا للقانون المعمول به.",
    ],
    status: "الحالة",
    statusText: "Jonas Fitness هو <strong>نشاط إضافي رقمي/برمجي</strong> للمؤسسة القائمة للبائع. إيداع هذا النشاط الإضافي لدى الإدارة الفرنسية (الشباك الموحد / السجل الوطني للمنشآت) <strong>معلَّق</strong> — تحديث إداري قيد التنفيذ، ولم يُعلَن اكتماله.",
    legalBasis: "الأساس القانوني والحقوق",
    controllerLabel: "مسؤول معالجة البيانات الشخصية لـ Progress هو البائع القانوني:",
    basesIntro: "عند تطبيق قانون حماية البيانات الأوروبي/البريطاني، نعتمد على الأسس القانونية التالية:",
    basesList: [
      "تقديم الخدمة وتخزين بياناتك التدريبية: تنفيذ العقد المبرم معك (المادة 6(1)(ب) من اللائحة العامة لحماية البيانات)؛",
      "سجلات الشراء/الوصول/التحقق: تنفيذ العقد، وبالنسبة للسجلات الضريبية والمحاسبية، الامتثال لالتزام قانوني (المادة 6(1)(ج))؛",
      "السجلات التقنية وإجراءات الأمن/مكافحة الاحتيال: مصلحتنا المشروعة في تشغيل خدمة آمنة وموثوقة (المادة 6(1)(و)).",
    ],
    rights: "لديك حقوق الوصول والتصحيح والمحو وتقييد المعالجة وإمكانية النقل والاعتراض عند تحقق الشروط القانونية. لأي طلب خصوصية، تواصل مع <a href=\"mailto:contact@jonascode.com\">contact@jonascode.com</a>.",
    transfers: "التحويلات الدولية",
    transfersText: "قد تعالج بعض جهات المعالجة لدينا (Clerk, Stripe, Vercel, Neon) بيانات على بنية تحتية خارج المنطقة الاقتصادية الأوروبية. عند حدوث تحويلات خارج المنطقة الاقتصادية الأوروبية، نعتمد على الضمانات التي تقدمها الجهات المعالجة المعنية، بما في ذلك البنود التعاقدية القياسية للمفوضية الأوروبية حيثما ينطبق ذلك.",
  },
} as const;

function PrivacyBody() {
  const { lang } = useLegalLang();
  const t = copy[lang];
  return (
    <LegalShell kicker={t.kicker} title={t.title} updated="2026">
      <p>{t.intro}</p>

      <section>
        <h2>{t.whatWeProcess}</h2>
        <ul>
          {t.processList.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
        <p>{t.noDataLine}</p>
      </section>

      <section>
        <h2>{t.processors}</h2>
        <ul>
          {t.processorList.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
      </section>

      <section>
        <h2>Stripe / Link</h2>
        <p>{t.stripeVsUs}</p>
      </section>

      <section>
        <h2>{t.retention}</h2>
        <ul>
          {t.retentionList.map((item) => <li key={item} dangerouslySetInnerHTML={{ __html: item }} />)}
        </ul>
      </section>

      <section>
        <h2>{t.status}</h2>
        <p dangerouslySetInnerHTML={{ __html: t.statusText }} />
      </section>

      <section>
        <h2>{t.legalBasis}</h2>
        <p>{t.controllerLabel}</p>
        <SellerIdentity />
        <p>{t.basesIntro}</p>
        <ul>
          {t.basesList.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p dangerouslySetInnerHTML={{ __html: t.rights }} />
        <h3>{t.transfers}</h3>
        <p>{t.transfersText}</p>
      </section>
    </LegalShell>
  );
}

export default function PrivacyContent() {
  return (
    <LegalLangProvider>
      <PrivacyBody />
    </LegalLangProvider>
  );
}