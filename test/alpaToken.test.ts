import { expect, use } from "chai";
import { Contract } from "ethers";
import { deployContract, MockProvider, solidity } from "ethereum-waffle";
import AlpaToken = require("../build/waffle/AlpaToken.json");

use(solidity);

describe("AlpaToken", () => {
  const [owner, user1] = new MockProvider().getWallets();
  let token: Contract;

  beforeEach(async () => {
    token = await deployContract(owner, AlpaToken);
  });

  it("has correct name", async () => {
    expect(await token.name()).to.eq("AlpaToken");
  });

  it("has correct symbol", async () => {
    expect(await token.symbol()).to.eq("ALPA");
  });

  it("has correct decimal", async () => {
    expect(await token.decimals()).to.eq(18);
  });

  it("has correct initial supply of 0", async () => {
    expect(await token.totalSupply()).to.eq(0);
  });

  it("owner can mint", async () => {
    await expect(token.mint(user1.address, "1000"))
      .to.emit(token, "Transfer")
      .withArgs(
        "0x0000000000000000000000000000000000000000",
        user1.address,
        "1000"
      );
  });

  it("other cannot mint", async () => {
    const tokenFromUser1 = token.connect(user1);

    await expect(tokenFromUser1.mint(user1.address, "1000")).to.be.reverted;
  });
});
