/**
 * 角色定义。规则来源：GAME.md §5。
 *
 * 这里只描述「角色的固有属性」，不含任何对局状态。
 * 视野的实际计算在 packages/engine/src/vision.ts，依据是本文件的 flag。
 */

export const SIDES = ["BLUE", "RED"] as const;
export type Side = (typeof SIDES)[number];

export const ROLE_IDS = [
  // 蓝方
  "MERLIN",
  "PERCIVAL",
  "LOYAL_SERVANT",
  "LANCELOT_BLUE",
  // 红方
  "MORGANA",
  "ASSASSIN",
  "MORDRED",
  "OBERON",
  "MINION",
  "LANCELOT_RED",
] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** 任务出牌权限。服务端据此强制，UI 只渲染合法项。 */
export type MissionCardRule = "SUCCESS_ONLY" | "FAIL_ONLY" | "BOTH";

export interface RoleMeta {
  readonly id: RoleId;
  /** 初始阵营。兰斯洛特可在对局中改变，见 engine/src/lancelot.ts */
  readonly side: Side;
  readonly name: string;
  /** 一句话身份说明，展示在身份卡上 */
  readonly tagline: string;
  /** 插画文件名（assets/roles/<styleId>/<artId>.webp） */
  readonly artId: string;
  readonly missionCard: MissionCardRule;
  /** 梅林能否看见此角色（仅对红方有意义）。莫德雷德 = false */
  readonly visibleToMerlin: boolean;
  /** 其他红方队友能否看见此角色。奥伯伦 = false */
  readonly visibleToEvil: boolean;
  /** 此角色能否看见红方队友。奥伯伦、红兰斯洛特 = false */
  readonly seesEvil: boolean;
  /** 是否为兰斯洛特（阵营可被忠诚牌翻转） */
  readonly isLancelot: boolean;
}

export const ROLES: { readonly [K in RoleId]: RoleMeta } = {
  MERLIN: {
    id: "MERLIN",
    side: "BLUE",
    name: "梅林",
    tagline: "你看得见邪恶，但不能让他们看见你。",
    artId: "merlin",
    missionCard: "SUCCESS_ONLY",
    visibleToMerlin: false,
    visibleToEvil: false,
    seesEvil: false,
    isLancelot: false,
  },
  PERCIVAL: {
    id: "PERCIVAL",
    side: "BLUE",
    name: "派西维尔",
    tagline: "两个人里有一个是梅林，另一个想让你死。",
    artId: "percival",
    missionCard: "SUCCESS_ONLY",
    visibleToMerlin: false,
    visibleToEvil: false,
    seesEvil: false,
    isLancelot: false,
  },
  LOYAL_SERVANT: {
    id: "LOYAL_SERVANT",
    side: "BLUE",
    name: "忠臣",
    tagline: "你一无所知，但你绝不背叛。",
    artId: "loyal-servant",
    missionCard: "SUCCESS_ONLY",
    visibleToMerlin: false,
    visibleToEvil: false,
    seesEvil: false,
    isLancelot: false,
  },
  LANCELOT_BLUE: {
    id: "LANCELOT_BLUE",
    side: "BLUE",
    name: "蓝兰斯洛特",
    tagline: "忠诚牌会决定你最终站在哪一边。",
    artId: "lancelot-blue",
    missionCard: "SUCCESS_ONLY",
    visibleToMerlin: false,
    visibleToEvil: false,
    seesEvil: false,
    isLancelot: true,
  },

  MORGANA: {
    id: "MORGANA",
    side: "RED",
    name: "莫甘娜",
    tagline: "在派西维尔眼中，你与梅林别无二致。",
    artId: "morgana",
    missionCard: "BOTH",
    visibleToMerlin: true,
    visibleToEvil: true,
    seesEvil: true,
    isLancelot: false,
  },
  ASSASSIN: {
    id: "ASSASSIN",
    side: "RED",
    name: "刺客",
    tagline: "三场任务失守之后，你还有最后一刀。",
    artId: "assassin",
    missionCard: "BOTH",
    visibleToMerlin: true,
    visibleToEvil: true,
    seesEvil: true,
    isLancelot: false,
  },
  MORDRED: {
    id: "MORDRED",
    side: "RED",
    name: "莫德雷德",
    tagline: "连梅林也看不见你。",
    artId: "mordred",
    missionCard: "BOTH",
    visibleToMerlin: false, // 铁律：梅林视野里没有莫德雷德
    visibleToEvil: true,
    seesEvil: true,
    isLancelot: false,
  },
  OBERON: {
    id: "OBERON",
    side: "RED",
    name: "奥伯伦",
    tagline: "你与同伴互不相识，各自为战。",
    artId: "oberon",
    missionCard: "BOTH",
    visibleToMerlin: true,
    visibleToEvil: false, // 队友看不见他
    seesEvil: false, // 他也看不见队友
    isLancelot: false,
  },
  MINION: {
    id: "MINION",
    side: "RED",
    name: "爪牙",
    tagline: "无名之辈，但足以搅乱一切。",
    artId: "minion",
    missionCard: "BOTH",
    visibleToMerlin: true,
    visibleToEvil: true,
    seesEvil: true,
    isLancelot: false,
  },
  LANCELOT_RED: {
    id: "LANCELOT_RED",
    side: "RED",
    name: "红兰斯洛特",
    tagline: "只要仍在红方，你的任务牌只能是失败。",
    artId: "lancelot-red",
    missionCard: "FAIL_ONLY",
    visibleToMerlin: true, // 梅林看得见，但只知道是红方
    visibleToEvil: true, // 队友看得见，且知道他是兰斯洛特
    seesEvil: false, // 他自己没有视野
    isLancelot: true,
  },
} as const;

export const isEvilRole = (id: RoleId): boolean => ROLES[id].side === "RED";
