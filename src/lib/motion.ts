/**
 * ─── LE VOCABULAIRE DE MOUVEMENT DE L'APPLICATION ──────────────────────────────
 *
 * Un seul endroit décide comment les choses entrent et sortent. Avant, chaque
 * composant improvisait : la fenêtre de confirmation apparaissait en 0,22 s mais
 * disparaissait D'UN COUP (elle n'avait pas d'`exit`), les cartes montaient de
 * 12 px, les dialogues de 20, et la barre latérale avait sa propre courbe. Rien
 * de tout cela n'était faux séparément — c'est l'ENSEMBLE qui donnait
 * l'impression d'une application cousue de plusieurs applications.
 *
 * ─── LES TROIS RÈGLES ─────────────────────────────────────────────────────────
 *
 *  1. ON N'ANIME QUE `transform` ET `opacity`. Ce sont les deux seules
 *     propriétés que le navigateur peut composer sur le GPU sans recalculer la
 *     mise en page. Animer une hauteur ou une largeur fait repasser le moteur
 *     de rendu sur toute la page à chaque image — c'est ce qui fait « ramer »
 *     une grille de deux cents produits sur le poste du comptoir.
 *
 *  2. CE QUI ENTRE ARRIVE DE LÀ OÙ ON L'A APPELÉ. Un dialogue monte, un menu
 *     descend, un panneau latéral vient du côté. Le mouvement dit d'où vient la
 *     chose et où elle retourne : c'est ce qui évite d'avoir à chercher des
 *     yeux ce qui vient d'apparaître.
 *
 *  3. LA SORTIE EST PLUS RAPIDE QUE L'ENTRÉE. On regarde ce qui arrive ; on
 *     n'attend jamais ce qui part. Une fermeture aussi lente que l'ouverture
 *     donne le sentiment que l'application traîne.
 *
 * ─── ET LE MOUVEMENT QU'ON NE VEUT PAS ────────────────────────────────────────
 *
 * `useMotionPrefs()` respecte le réglage système « réduire les animations ».
 * Ce n'est pas un détail de confort : pour une partie des gens, un panneau qui
 * glisse déclenche un vrai malaise. Quand le réglage est actif, TOUT se réduit
 * à un fondu — rien ne bouge, mais rien ne saute non plus.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { useMemo } from 'react';
import { useReducedMotion, type Variants, type Transition } from 'motion/react';

// ─── Les courbes ──────────────────────────────────────────────────────────────

/**
 * `easeOut` prononcé : démarrage franc, arrivée qui se pose. C'est la courbe
 * de tout ce qui APPARAÎT — elle donne l'impression que l'élément était déjà
 * en route avant qu'on le voie.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Départ franc pour ce qui SORT : on ne regarde pas une fermeture. */
export const EASE_IN = [0.4, 0, 1, 1] as const;

/** Ressort « posé » : il arrive vite et ne rebondit qu'à peine. */
export const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 };

/** Ressort plus vif, pour les petits éléments (pastilles, boutons d'action). */
export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 500, damping: 28, mass: 0.6 };

/** Durées de référence, en secondes. */
export const DUR = {
  /** Un changement d'état sur place (couleur, pression d'un bouton). */
  instant: 0.12,
  /** Une sortie. */
  exit: 0.16,
  /** Une entrée courante. */
  enter: 0.26,
  /** Une entrée qui porte beaucoup de contenu (page, grand dialogue). */
  page: 0.3,
} as const;

// ─── Les variantes ────────────────────────────────────────────────────────────

/**
 * LA PAGE. Elle monte de quelques pixels en apparaissant et repart vers le haut
 * en disparaissant : la nouvelle page semble pousser l'ancienne, ce qui se lit
 * comme une avancée plutôt que comme un remplacement.
 *
 * Le déplacement est VOLONTAIREMENT petit (10 px). Une page entière qui glisse
 * de cinquante pixels attire l'œil sur le mouvement au lieu du contenu, et
 * devient pénible dès la dixième navigation de la journée.
 */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1, y: 0,
    transition: { duration: DUR.page, ease: EASE_OUT, staggerChildren: 0.04, delayChildren: 0.04 },
  },
  out: { opacity: 0, y: -8, transition: { duration: DUR.exit, ease: EASE_IN } },
};

/** Les blocs d'une page, décalés les uns après les autres. */
export const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.enter, ease: EASE_OUT } },
};

/**
 * LE VOILE d'un dialogue. Il ne fait que se teinter : lui donner un mouvement
 * ferait bouger tout l'arrière-plan derrière la fenêtre, et l'œil ne saurait
 * plus quoi suivre.
 */
export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DUR.enter, ease: EASE_OUT } },
  out: { opacity: 0, transition: { duration: DUR.exit, ease: EASE_IN } },
};

/**
 * LE DIALOGUE. Il monte depuis le bas en se dépliant légèrement — le geste
 * d'une fiche qu'on sort d'un tiroir. Il repart par où il est venu.
 *
 * Le ressort est ce qui fait la différence avec l'ancienne version : une durée
 * fixe donne une arrivée mécanique, le ressort donne un poids.
 */
export const dialogVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 24 },
  show: { opacity: 1, scale: 1, y: 0, transition: SPRING },
  out: { opacity: 0, scale: 0.97, y: 12, transition: { duration: DUR.exit, ease: EASE_IN } },
};

/**
 * LA CONFIRMATION. Plus petite, plus brève, et elle arrive en se posant plutôt
 * qu'en montant : c'est une question, pas un espace de travail. Le léger
 * dépassement d'échelle attire l'œil sans faire sursauter.
 */
export const confirmVariants: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: SPRING_SNAPPY },
  out: { opacity: 0, scale: 0.95, transition: { duration: DUR.exit, ease: EASE_IN } },
};

/** LE TIROIR MOBILE de la barre latérale — il vient du bord, il y retourne. */
export const drawerVariants: Variants = {
  hidden: { x: '-100%' },
  show: { x: 0, transition: { type: 'spring', stiffness: 420, damping: 38 } },
  out: { x: '-100%', transition: { duration: 0.2, ease: EASE_IN } },
};

/**
 * UNE SECTION QUI SE DÉPLIE (les écrans d'une cafétéria dans le menu).
 *
 * `height: auto` est l'exception assumée à la règle « transform et opacity
 * seulement » : il n'existe aucune autre façon de déplier une liste dont on ne
 * connaît pas la hauteur. Le coût reste faible — quelques lignes, jamais une
 * grille de produits.
 */
export const collapseVariants: Variants = {
  hidden: { height: 0, opacity: 0 },
  show: {
    height: 'auto', opacity: 1,
    transition: { height: { duration: 0.24, ease: EASE_OUT }, opacity: { duration: 0.18, delay: 0.04 } },
  },
  out: {
    height: 0, opacity: 0,
    transition: { height: { duration: 0.18, ease: EASE_IN }, opacity: { duration: 0.1 } },
  },
};

/** Les entrées d'une section dépliée, en cascade. */
export const menuListVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.028, delayChildren: 0.03 } },
  out: {},
};

export const menuItemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE_OUT } },
  out: { opacity: 0, x: -4, transition: { duration: 0.1 } },
};

/** Une carte d'une grille (produit, client, dépense…). */
export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.99 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.enter, ease: EASE_OUT } },
  out: { opacity: 0, scale: 0.97, transition: { duration: DUR.exit, ease: EASE_IN } },
};

/** Un message éphémère : il arrive par la droite, il repart par la droite. */
export const toastVariants: Variants = {
  hidden: { opacity: 0, x: 40, scale: 0.96 },
  show: { opacity: 1, x: 0, scale: 1, transition: SPRING },
  out: { opacity: 0, x: 24, scale: 0.96, transition: { duration: DUR.exit, ease: EASE_IN } },
};

/** Un panneau déroulant ancré à son bouton (cloche, menus). */
export const popoverVariants: Variants = {
  hidden: { opacity: 0, y: -8, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: EASE_OUT } },
  out: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12, ease: EASE_IN } },
};

// ─── Les gestes ───────────────────────────────────────────────────────────────

/**
 * LA RÉPONSE AU CLIC. Un bouton qui ne bouge pas sous le doigt laisse douter
 * qu'il a été pressé — et sur un écran tactile de comptoir, ce doute se paie
 * en double appui, donc en double vente.
 *
 * L'enfoncement est franc (0,94) et instantané ; le relâchement rebondit.
 */
export const pressable = {
  whileHover: { scale: 1.03 },
  whileTap: { scale: 0.94 },
  transition: SPRING_SNAPPY,
} as const;

/** Version discrète, pour un bouton déjà entouré (ligne de tableau, onglet). */
export const pressableSubtle = {
  whileHover: { scale: 1.015 },
  whileTap: { scale: 0.97 },
  transition: SPRING_SNAPPY,
} as const;

// ─── Le respect du réglage système ────────────────────────────────────────────

/** Tout, réduit au fondu — la version « sans mouvement ». */
const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.15 } },
  out: { opacity: 0, transition: { duration: 0.1 } },
};

const noGesture = { whileHover: undefined, whileTap: undefined, transition: undefined } as const;

export interface MotionPrefs {
  reduce: boolean;
  page: Variants;
  section: Variants;
  backdrop: Variants;
  dialog: Variants;
  confirm: Variants;
  drawer: Variants;
  collapse: Variants;
  menuList: Variants;
  menuItem: Variants;
  card: Variants;
  toast: Variants;
  popover: Variants;
  press: typeof pressable | typeof noGesture;
  pressSubtle: typeof pressableSubtle | typeof noGesture;
}

/**
 * Le vocabulaire de mouvement à utiliser MAINTENANT, selon le réglage système.
 *
 * Un composant qui importerait `dialogVariants` directement ignorerait ce
 * réglage. Passer par ce hook est ce qui garantit qu'un seul interrupteur — le
 * réglage du système d'exploitation — calme réellement toute l'application.
 */
export function useMotionPrefs(): MotionPrefs {
  const reduce = !!useReducedMotion();
  return useMemo(() => (reduce
    ? {
      reduce: true,
      page: fadeOnly, section: fadeOnly, backdrop: fadeOnly, dialog: fadeOnly,
      confirm: fadeOnly, drawer: fadeOnly, collapse: collapseVariants,
      menuList: fadeOnly, menuItem: fadeOnly, card: fadeOnly,
      toast: fadeOnly, popover: fadeOnly,
      press: noGesture, pressSubtle: noGesture,
    }
    : {
      reduce: false,
      page: pageVariants, section: sectionVariants, backdrop: backdropVariants,
      dialog: dialogVariants, confirm: confirmVariants, drawer: drawerVariants,
      collapse: collapseVariants, menuList: menuListVariants, menuItem: menuItemVariants,
      card: cardVariants, toast: toastVariants, popover: popoverVariants,
      press: pressable, pressSubtle: pressableSubtle,
    }), [reduce]);
}
