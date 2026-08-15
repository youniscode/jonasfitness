export type ReminderLanguage = "fr" | "en" | "ar";
export type ReminderMessages = Record<ReminderLanguage, string>;

export function reminderLanguage(value: unknown): ReminderLanguage {
  return value === "en" || value === "ar" ? value : "fr";
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function sessionWhen(startAt: Date, language: ReminderLanguage) {
  const locale = language === "fr" ? "fr-FR" : language === "ar" ? "ar" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(startAt);
}

export function sessionReminderMessages(name: string, startAt: Date, pulseUrl: string): ReminderMessages {
  const first = firstName(name);
  return {
    fr: `Bonjour ${first}, petit rappel : votre séance avec Jonas est prévue ${sessionWhen(startAt, "fr")} (heure de Paris). Merci de compléter votre Pulse Check avant la séance : ${pulseUrl}`,
    en: `Hi ${first}, a quick reminder: your session with Jonas is scheduled for ${sessionWhen(startAt, "en")} (Paris time). Please complete your Pulse Check before the session: ${pulseUrl}`,
    ar: `مرحباً ${first}، تذكير سريع: جلستك مع جوناس مقررة ${sessionWhen(startAt, "ar")} بتوقيت باريس. يرجى إكمال فحص الاستعداد قبل الجلسة: ${pulseUrl}`,
  };
}

export function leadFollowUpMessages(name: string): ReminderMessages {
  const first = firstName(name);
  return {
    fr: `Bonjour ${first}, je reviens vers vous concernant votre demande de coaching Jonas Fitness. Souhaitez-vous que nous organisions un court appel pour parler de vos objectifs et de vos disponibilités ?`,
    en: `Hi ${first}, I’m following up about your Jonas Fitness coaching request. Would you like to arrange a short call to discuss your goals and availability?`,
    ar: `مرحباً ${first}، أتابع معك بخصوص طلب التدريب مع Jonas Fitness. هل ترغب في تحديد مكالمة قصيرة لمناقشة أهدافك والأوقات المناسبة لك؟`,
  };
}
