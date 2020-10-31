export type TestCaseAlpaca = {
  gene: string;
  energy: number;
};

export type ContractAlpaca = {
  id: number;
  isReady: boolean;
  cooldownEndBlock: number;
  birthTime: number;
  matronId: number;
  sireId: number;
  hatchingCost: number;
  hatchingCostMultiplier: number;
  hatchCostMultiplierEndBlock: number;
  generation: number;
  gene: number;
  energy: number;
  state: number;
};

export const testAlpaca1: TestCaseAlpaca = {
  gene: "620662782354206032694144109774754641861551612911987663939884",
  energy: 520,
};

export const testAlpaca2: TestCaseAlpaca = {
  gene: "970223767325840394100071979034167079185162476652294627010635",
  energy: 620,
};

export const testAlpaca3: TestCaseAlpaca = {
  gene: "471373148756452289561829685112340574709595117932251003825514",
  energy: 530,
};
