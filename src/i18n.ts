/**
 * ─── Langue de l'interface ─────────────────────────────────────────────────────
 *
 * L'application est écrite en FRANÇAIS, directement dans les composants. Ce
 * fichier ne porte donc pas une table de traduction de toute l'interface — il
 * n'en aurait que la moitié, et la moitié manquante serait invisible jusqu'au
 * jour où quelqu'un basculerait en arabe.
 *
 * Il fait deux choses, et seulement deux :
 *
 *  1. LA DIRECTION DE LA PAGE. Passer en arabe bascule `dir="rtl"` sur tout le
 *     document (voir `App.tsx`), ce qui retourne la mise en page entière —
 *     barre latérale, tableaux, alignements.
 *
 *  2. LES QUELQUES LIBELLÉS PARTAGÉS que l'on veut voir traduits proprement
 *     plutôt que passés à la moulinette automatique.
 *
 * Le reste du français est traduit À L'EXÉCUTION par `src/lib/autoTranslate.ts`,
 * qui balaie le texte affiché avec le dictionnaire de `src/lib/frToAr.ts`. Un
 * mot absent du dictionnaire reste en français : c'est visible, donc corrigible
 * — là où une clé de traduction oubliée n'aurait affiché qu'un identifiant.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

const resources = {
  fr: {
    translation: {
      app_name: "Altech Cafétéria",
      tagline: "Gestion de cafétéria",

      common: {
        save: "Enregistrer",
        cancel: "Annuler",
        delete: "Supprimer",
        edit: "Modifier",
        create: "Créer",
        search: "Rechercher…",
        loading: "Chargement…",
        empty: "Aucun résultat",
        confirm: "Confirmer",
        close: "Fermer",
      },

      nav: {
        dashboard: "Tableau de bord",
        general_cash: "Caisse générale",
        general_reports: "Rapports généraux",
        settings: "Réglages",
        profile: "Mon profil",
        logout: "Déconnexion",
        hide_sidebar: "Masquer le menu",
        show_sidebar: "Afficher le menu",
      },

      login: {
        title: "Connexion",
        subtitle: "Accédez à votre espace de gestion.",
        identifier: "Identifiant ou e-mail",
        password: "Mot de passe",
        submit: "Se connecter",
        create_admin: "Créer un compte administrateur",
        error_missing: "Renseignez votre identifiant et votre mot de passe.",
        error_invalid: "Identifiant ou mot de passe incorrect.",
      },
    },
  },

  ar: {
    translation: {
      app_name: "ألتك كافيتيريا",
      tagline: "إدارة الكافيتيريا",

      common: {
        save: "حفظ",
        cancel: "إلغاء",
        delete: "حذف",
        edit: "تعديل",
        create: "إنشاء",
        search: "بحث…",
        loading: "جارٍ التحميل…",
        empty: "لا توجد نتائج",
        confirm: "تأكيد",
        close: "إغلاق",
      },

      nav: {
        dashboard: "لوحة التحكم",
        general_cash: "الصندوق العام",
        general_reports: "التقارير العامة",
        settings: "الإعدادات",
        profile: "ملفي الشخصي",
        logout: "تسجيل الخروج",
        hide_sidebar: "إخفاء القائمة",
        show_sidebar: "إظهار القائمة",
      },

      login: {
        title: "تسجيل الدخول",
        subtitle: "ادخل إلى مساحة الإدارة الخاصة بك.",
        identifier: "المعرّف أو البريد الإلكتروني",
        password: "كلمة المرور",
        submit: "دخول",
        create_admin: "إنشاء حساب مسؤول",
        error_missing: "أدخل المعرّف وكلمة المرور.",
        error_invalid: "المعرّف أو كلمة المرور غير صحيحة.",
      },
    },
  },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: resources as any,
    fallbackLng: "fr",
    supportedLngs: ["fr", "ar"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "altech.lang",
    },
  });

export default i18n;
