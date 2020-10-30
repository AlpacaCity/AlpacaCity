import { expect, use } from "chai";
import { Contract } from "ethers";
import { deployContract, MockProvider, solidity } from "ethereum-waffle";
import AlpaToken = require("../build/waffle/AlpaToken.json");
import AlpaReward = require("../build/waffle/AlpaReward.json");

use(solidity);

describe("AlpaReward", () => {
  const [owner, user1, user2] = new MockProvider().getWallets();
  let alpa: Contract;
  let reward: Contract;

  beforeEach(async () => {
    alpa = await deployContract(owner, AlpaToken);
    reward = await deployContract(owner, AlpaReward, [alpa.address]);
  });

  describe("ERC20 information", () => {
    it("has correct name", async () => {
      expect(await reward.name()).to.eq("AlpaReward");
    });

    it("has correct symbol", async () => {
      expect(await reward.symbol()).to.eq("xALPA");
    });

    it("has correct decimal", async () => {
      expect(await reward.decimals()).to.eq(18);
    });

    it("has correct initial supply of 0", async () => {
      expect(await reward.totalSupply()).to.eq(0);
    });
  });

  describe("staking and unstake", () => {
    beforeEach(async () => {
      await alpa.mint(user1.address, 100);
      await alpa.mint(user2.address, 100);

      expect(await alpa.totalSupply()).to.eq(200);
      expect(await alpa.balanceOf(user1.address)).to.eq(100);
      expect(await alpa.balanceOf(user2.address)).to.eq(100);
    });

    context("with one participant", async () => {
      let userAlpa: Contract;
      let userReward: Contract;

      beforeEach(() => {
        userReward = reward.connect(user1);
        userAlpa = alpa.connect(user1);
      });

      it("leaves with correct shares", async () => {
        // user1 approve reward contract from transfering
        await userAlpa.approve(reward.address, 100);

        // user1 enters with 100 ALPA
        await userReward.enter(100);
        expect(await alpa.balanceOf(user1.address)).to.eq(0);
        expect(await reward.balanceOf(user1.address)).to.eq(100);
        expect(await reward.totalSupply()).to.eq(100);

        // mint more token to reward contract to simulate birthing fee transfer
        await alpa.mint(reward.address, 50);

        // user leaves with 100 xALPA
        await userReward.leave(100);
        expect(await alpa.balanceOf(user1.address)).to.eq(150);
        expect(await reward.balanceOf(user1.address)).to.eq(0);
        expect(await reward.totalSupply()).to.eq(0);
      });
    });

    context("with one participant", async () => {
      let user1Alpa: Contract;
      let user1Reward: Contract;

      let user2Alpa: Contract;
      let user2Reward: Contract;

      beforeEach(() => {
        user1Reward = reward.connect(user1);
        user1Alpa = alpa.connect(user1);

        user2Reward = reward.connect(user2);
        user2Alpa = alpa.connect(user2);
      });

      context("with equal amount of shares", async () => {
        it("leaves with correct shares", async () => {
          // user1 approve reward contract from transfering
          await user1Alpa.approve(reward.address, 100);

          // user2 approve reward contract from transfering
          await user2Alpa.approve(reward.address, 100);

          // user1 enters with 100 ALPA
          await user1Reward.enter(100);
          expect(await alpa.balanceOf(user1.address)).to.eq(0);
          expect(await reward.balanceOf(user1.address)).to.eq(100);
          expect(await reward.totalSupply()).to.eq(100);

          // user2 enters with 100 ALPA
          await user2Reward.enter(100);
          expect(await alpa.balanceOf(user2.address)).to.eq(0);
          expect(await reward.balanceOf(user2.address)).to.eq(100);
          expect(await reward.totalSupply()).to.eq(200);

          // mint more token to reward contract to simulate birthing fee transfer
          await alpa.mint(reward.address, 50);

          // user1 leaves with 100 xALPA
          await user1Reward.leave(100);
          expect(await alpa.balanceOf(user1.address)).to.eq(125);
          expect(await reward.balanceOf(user1.address)).to.eq(0);
          expect(await reward.totalSupply()).to.eq(100);

          // user2 leaves with 100 xALPA
          await user2Reward.leave(100);
          expect(await alpa.balanceOf(user2.address)).to.eq(125);
          expect(await reward.balanceOf(user2.address)).to.eq(0);
          expect(await reward.totalSupply()).to.eq(0);
        });
      });

      context("with different amount of shares", async () => {
        it("leaves with correct shares", async () => {
          // user1 approve reward contract from transfering
          await user1Alpa.approve(reward.address, 100);

          // user2 approve reward contract from transfering
          await user2Alpa.approve(reward.address, 50);

          // user1 enters with 100 ALPA
          await user1Reward.enter(100);
          expect(await alpa.balanceOf(user1.address)).to.eq(0);
          expect(await reward.balanceOf(user1.address)).to.eq(100);
          expect(await reward.totalSupply()).to.eq(100);

          // user2 enters with 50 ALPA
          await user2Reward.enter(50);

          // transfered 50 ALPA, still has 50 ALPA left
          expect(await alpa.balanceOf(user2.address)).to.eq(50);
          expect(await reward.balanceOf(user2.address)).to.eq(50);
          expect(await reward.totalSupply()).to.eq(150);

          // mint more token to reward contract to simulate birthing fee transfer
          await alpa.mint(reward.address, 60);

          // user1 leaves with 100 xALPA
          await user1Reward.leave(100);
          expect(await alpa.balanceOf(user1.address)).to.eq(140);
          expect(await reward.balanceOf(user1.address)).to.eq(0);
          expect(await reward.totalSupply()).to.eq(50);

          // user2 leaves with 50 xALPA
          await user2Reward.leave(50);
          expect(await alpa.balanceOf(user2.address)).to.eq(120);
          expect(await reward.balanceOf(user2.address)).to.eq(0);
          expect(await reward.totalSupply()).to.eq(0);
        });
      });
    });
  });
});
