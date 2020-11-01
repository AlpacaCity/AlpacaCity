import { expect, use } from "chai";
import { Contract, BigNumber } from "ethers";
import {
  deployContract,
  MockProvider,
  solidity,
  deployMockContract,
} from "ethereum-waffle";
import { ContractAlpaca } from "./util/alpaca";

import GeneScience = require("../build/waffle/IGeneScience.json");
import CryptoAlpaca = require("../build/waffle/AlpacaCore.json");
import AlpaReward = require("../build/waffle/AlpaReward.json");
import AlpaToken = require("../build/waffle/AlpaToken.json");
import MasterChef = require("../build/waffle/MasterChef.json");
import IERC20 = require("../build/waffle/IERC20.json");
import MockCryptoAlpacaReceiver = require("../build/waffle/MockCryptoAlpacaReceiver.json");

use(solidity);

describe("MasterChef", () => {
  const provider = new MockProvider({
    ganacheOptions: {
      gasLimit: "0xf00000",
    },
  });
  const [owner, user1, user2, dev, community, operator] = provider.getWallets();

  let science: Contract;
  let alpaToken: Contract;
  let reward: Contract;
  let alpaca: Contract;
  let masterChef: Contract;
  let mockCryptoAlpacaReceiver: Contract;

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const ALPA_PER_BLOCK = BigNumber.from("100000000000000000000");
  const STARTING_BLOCK = BigNumber.from("0");
  let PER_SHARE_MULTIPLIER: BigNumber;
  let EMPTY_ALPACA_ENERGY: BigNumber;

  beforeEach(async () => {
    science = await deployMockContract(owner, GeneScience.abi);
    alpaToken = await deployContract(owner, AlpaToken);
    reward = await deployContract(owner, AlpaReward, [alpaToken.address]);
    alpaca = await deployContract(
      owner,
      CryptoAlpaca,
      [
        alpaToken.address,
        science.address,
        operator.address,
        dev.address,
        reward.address,
      ],
      {
        gasLimit: "0xf00000",
      }
    );
    masterChef = await deployContract(owner, MasterChef, [
      alpaToken.address,
      alpaca.address,
      dev.address,
      community.address,
      ALPA_PER_BLOCK.toString(),
      STARTING_BLOCK,
    ]);
    PER_SHARE_MULTIPLIER = await masterChef.SAFE_MULTIPLIER();
    EMPTY_ALPACA_ENERGY = await masterChef.EMPTY_ALPACA_ENERGY();

    mockCryptoAlpacaReceiver = await deployContract(
      owner,
      MockCryptoAlpacaReceiver
    );

    // Transfer alpaca owner to master chef so it can mint
    await alpaToken.transferOwnership(masterChef.address);
  });

  const mintedAlpa = (numBlocks: number) => {
    const total = ALPA_PER_BLOCK.mul(numBlocks);

    return {
      poolAlpa: total.mul(8).div(10), 
      devAlpa: total.div(10), 
      communityAlpa: total.div(10)
    } 
  }

  context("Basic infos", async () => {
    it("has correct alpa token contract", async () => {
      expect(await masterChef.alpa()).to.eq(alpaToken.address);
    });

    it("has correct crypto alpaca contract", async () => {
      expect(await masterChef.cryptoAlpaca()).to.eq(alpaca.address);
    });

    it("has correct dev address", async () => {
      expect(await masterChef.devAddr()).to.eq(dev.address);
    });

    it("has correct community address", async () => {
      expect(await masterChef.communityAddr()).to.eq(community.address);
    });

    it("has correct alpa per block", async () => {
      expect(await masterChef.alpaPerBlock()).to.eq(ALPA_PER_BLOCK);
    });

    it("has correct starting block", async () => {
      expect(await masterChef.startBlock()).to.eq(STARTING_BLOCK);
    });

    it("has correct empty alpaca energy", async () => {
      expect(await masterChef.EMPTY_ALPACA_ENERGY()).to.eq(1);
    });

    it("has correct safe multiplier", async () => {
      const expectedMultiplier = BigNumber.from("10000000000000000")
      expect(await masterChef.SAFE_MULTIPLIER()).to.eq(expectedMultiplier);
    });
  });

  context("Access control", async () => {
    it("has correct owner", async () => {
      expect(await masterChef.owner()).to.eq(owner.address);
    });

    it("ALPA owner is masterChef", async () => {
      expect(await alpaToken.owner()).to.eq(masterChef.address);
    });

    it("can transfer ownership", async () => {
      await masterChef.transferOwnership(user1.address);
      expect(await masterChef.owner()).to.eq(user1.address);
    });

    it("can transfer alpa ownership", async () => {
      expect(await alpaToken.owner()).to.eq(masterChef.address);
      
      await masterChef.setAlpaOwner(user1.address);
      expect(await alpaToken.owner()).to.eq(user1.address);
    });
  })

  context("Alpaca operator update energy", async () => {
    let testAlpaca1: ContractAlpaca;
    let testAlpaca2: ContractAlpaca;
    const alpacaEnergy = BigNumber.from(500);

    beforeEach(async () => {
      await alpaca.createGen0Alpaca(
        "620662782354206032694144109774754641861551612911987663939884",
        alpacaEnergy,
        user1.address
      );
      await alpaca.createGen0Alpaca(
        "620662782354206032694144109774754641861551612911987663939884",
        alpacaEnergy,
        user1.address
      );
      testAlpaca1 = (await alpaca.getAlpaca(1)) as ContractAlpaca;
      testAlpaca2 = (await alpaca.getAlpaca(2)) as ContractAlpaca;

      const alpacaFromUser1 = alpaca.connect(user1);
      await alpacaFromUser1.safeTransferFrom(
        user1.address,
        masterChef.address,
        testAlpaca1.id,
        1,
        "0x00"
      );
      await alpacaFromUser1.safeTransferFrom(
        user1.address,
        mockCryptoAlpacaReceiver.address,
        testAlpaca2.id,
        1,
        "0x00"
      );
    });

    context("operator updates alpaca energy", () => {
      it("updates user global info alpaca energy", async () => {
        const alpacaFromOperator = alpaca.connect(operator);
        const newAlpacaEnergy = "1000";
        await expect(
          alpacaFromOperator.updateAlpacaEnergy(
            masterChef.address,
            testAlpaca1.id,
            newAlpacaEnergy
          )
        )
          .to.emit(alpaca, "EnergyChanged")
          .withArgs(testAlpaca1.id, testAlpaca1.energy, newAlpacaEnergy);

        const globalInfo = await masterChef.userGlobalInfo(user1.address);
        expect(globalInfo.alpacaID).to.eq(testAlpaca1.id);
        expect(globalInfo.alpacaEnergy).to.eq(newAlpacaEnergy);
      });

      it("contract that doesn't implement ICryptoAlpacaEnergyListener can still update energy", async () => {
        const alpacaFromOperator = alpaca.connect(operator);
        const newAlpacaEnergy = "1000";
        await expect(
          alpacaFromOperator.updateAlpacaEnergy(
            mockCryptoAlpacaReceiver.address,
            testAlpaca2.id,
            newAlpacaEnergy
          )
        )
          .to.emit(alpaca, "EnergyChanged")
          .withArgs(testAlpaca2.id, testAlpaca2.energy, newAlpacaEnergy);
      });
    });
  });

  context("Can add an set new lp pool", async () => {
    it("Add new lp to the pool", async () => {
      const mockLPToken = await deployMockContract(owner, IERC20.abi);
      const allocPoint = 100;

      await masterChef.add(allocPoint, mockLPToken.address, false);

      const pool = await masterChef.poolInfo(0);
      expect(pool.lpToken).to.eq(mockLPToken.address);
      expect(pool.allocPoint).to.eq(allocPoint);
      expect(pool.accAlpaPerShare).to.eq(0);
      expect(pool.accShare).to.eq(0);
    });
  });

  context("With one lp pool and one user", async () => {
    const POOL_ALLOCATION_POINT = 100;
    const poolID = 0;
    const depositLPAmount = BigNumber.from(10000);

    let lpToken: Contract;

    beforeEach(async () => {
      lpToken = await deployContract(owner, AlpaToken);
      await masterChef.add(POOL_ALLOCATION_POINT, lpToken.address, false);

      await lpToken.mint(user1.address, depositLPAmount.toString());

      const lpTokenFromUser1 = lpToken.connect(user1);
      await lpTokenFromUser1.approve(
        masterChef.address,
        depositLPAmount.toString()
      );
    });

    context("with no alpaca", async () => {
      it("recievs correct reward", async () => {
        const masterchefFromUser1 = masterChef.connect(user1);
        await masterchefFromUser1.deposit(poolID, depositLPAmount.toString());

        expect(await lpToken.balanceOf(masterChef.address)).to.eq(
          depositLPAmount
        );

        let pool = await masterChef.poolInfo(poolID);
        expect(pool.accAlpaPerShare).to.eq(0);
        expect(pool.accShare).to.eq(depositLPAmount.mul(EMPTY_ALPACA_ENERGY));

        let info = await masterChef.userInfo(poolID, user1.address);
        expect(info.amount).to.eq(depositLPAmount);
        expect(info.rewardDebt).to.eq(0);

        const globalInfo = await masterChef.userGlobalInfo(user1.address);
        expect(globalInfo.alpacaID).to.eq(0);
        expect(globalInfo.alpacaEnergy).to.eq(0);

        // deposit 0 to trigger reward
        await masterchefFromUser1.deposit(poolID, 0);

        const {poolAlpa, devAlpa, communityAlpa} = mintedAlpa(1);
        const share = poolAlpa.mul(PER_SHARE_MULTIPLIER).div(
          depositLPAmount.mul(EMPTY_ALPACA_ENERGY)
        );

        pool = await masterChef.poolInfo(poolID);
        expect(pool.accAlpaPerShare).to.eq(share);
        expect(pool.accShare).to.eq(depositLPAmount.mul(EMPTY_ALPACA_ENERGY));

        info = await masterChef.userInfo(poolID, user1.address);
        expect(info.amount).to.eq(depositLPAmount.toString());
        expect(info.rewardDebt).to.eq(
          depositLPAmount
            .mul(EMPTY_ALPACA_ENERGY)
            .mul(share)
            .div(PER_SHARE_MULTIPLIER)
        );

        expect(await alpaToken.balanceOf(user1.address)).to.eq(poolAlpa);
        expect(await alpaToken.balanceOf(dev.address)).to.eq(devAlpa);
        expect(await alpaToken.balanceOf(community.address)).to.eq(communityAlpa);
      });
    });

    context("with one alpaca", async () => {
      let testAlpaca: ContractAlpaca;
      const alpacaEnergy = BigNumber.from(500);

      beforeEach(async () => {
        await alpaca.createGen0Alpaca(
          "620662782354206032694144109774754641861551612911987663939884",
          alpacaEnergy,
          user1.address
        );
        testAlpaca = (await alpaca.getAlpaca(1)) as ContractAlpaca;
        expect(await alpaca.balanceOf(user1.address, testAlpaca.id)).to.eq(1);
      });

      it("recievs correct reward", async () => {
        // transfer alpaca to masterchef
        const alpacaFromUser1 = alpaca.connect(user1);
        await alpacaFromUser1.safeTransferFrom(
          user1.address,
          masterChef.address,
          testAlpaca.id,
          1,
          "0x00"
        );

        /**
         * check user1 has right to breed
         */
        expect(
          await alpaca.hasPermissionToBreedAsSire(user1.address, testAlpaca.id)
        ).to.eq(true);
        expect(await alpaca.balanceOf(user1.address, testAlpaca.id)).to.eq(0);

        const globalInfo = await masterChef.userGlobalInfo(user1.address);
        expect(globalInfo.alpacaID).to.eq(1);
        expect(globalInfo.alpacaEnergy).to.eq(alpacaEnergy);

        const masterchefFromUser1 = masterChef.connect(user1);
        await masterchefFromUser1.deposit(poolID, depositLPAmount.toString());

        expect(await lpToken.balanceOf(masterChef.address)).to.eq(
          depositLPAmount
        );

        let pool = await masterChef.poolInfo(poolID);
        expect(pool.accAlpaPerShare).to.eq(0);
        expect(pool.accShare).to.eq(alpacaEnergy.mul(depositLPAmount));

        let info = await masterChef.userInfo(poolID, user1.address);
        expect(info.amount).to.eq(depositLPAmount);
        expect(info.rewardDebt).to.eq(0);

        // deposit 0 to trigger reward
        await masterchefFromUser1.deposit(poolID, 0);

        const {poolAlpa, devAlpa, communityAlpa} = mintedAlpa(1);
        
        const share = poolAlpa.mul(PER_SHARE_MULTIPLIER).div(
          alpacaEnergy.mul(depositLPAmount)
        );
        pool = await masterChef.poolInfo(poolID);
        expect(pool.accAlpaPerShare).to.eq(share);
        expect(pool.accShare).to.eq(alpacaEnergy.mul(depositLPAmount));

        info = await masterChef.userInfo(poolID, user1.address);
        expect(info.amount).to.eq(depositLPAmount.toString());
        expect(info.rewardDebt).to.eq(
          depositLPAmount.mul(alpacaEnergy).mul(share).div(PER_SHARE_MULTIPLIER)
        );

        expect(await alpaToken.balanceOf(user1.address)).to.eq(poolAlpa);
        expect(await alpaToken.balanceOf(dev.address)).to.eq(devAlpa);
        expect(await alpaToken.balanceOf(community.address)).to.eq(communityAlpa);
      });
    });

    context("With no alpaca initially, then transfered", async () => {
      let testAlpaca: ContractAlpaca;
      const alpacaEnergy = BigNumber.from(500);

      beforeEach(async () => {
        await alpaca.createGen0Alpaca(
          "620662782354206032694144109774754641861551612911987663939884",
          alpacaEnergy,
          user1.address
        );
        testAlpaca = (await alpaca.getAlpaca(1)) as ContractAlpaca;
        expect(await alpaca.balanceOf(user1.address, testAlpaca.id)).to.eq(1);
      });

      it("recievs correct reward", async () => {
        /**
         * user1 deposit
         */
        const masterchefFromUser1 = masterChef.connect(user1);
        await masterchefFromUser1.deposit(poolID, depositLPAmount.toString());

        expect(await lpToken.balanceOf(masterChef.address)).to.eq(
          depositLPAmount
        );

        let pool = await masterChef.poolInfo(poolID);
        expect(pool.accAlpaPerShare).to.eq(0);
        expect(pool.accShare).to.eq(EMPTY_ALPACA_ENERGY.mul(depositLPAmount));

        let info = await masterChef.userInfo(poolID, user1.address);
        expect(info.amount).to.eq(depositLPAmount);
        expect(info.rewardDebt).to.eq(0);

        const {poolAlpa, devAlpa, communityAlpa} = mintedAlpa(1);
        /**
         * transfer alpaca to masterchef
         */
        const alpacaFromUser1 = alpaca.connect(user1);
        await expect(
          alpacaFromUser1.safeTransferFrom(
            user1.address,
            masterChef.address,
            testAlpaca.id,
            1,
            "0x00"
          )
        )
          .to.emit(alpaToken, "Transfer")
          .withArgs(ZERO_ADDRESS, dev.address, devAlpa)
          .to.emit(alpaToken, "Transfer")
          .withArgs(ZERO_ADDRESS, community.address, communityAlpa)
          .to.emit(alpaToken, "Transfer")
          .withArgs(ZERO_ADDRESS, masterChef.address, poolAlpa)
          .to.emit(alpaToken, "Transfer")
          .withArgs(masterChef.address, user1.address, poolAlpa);

        expect(await alpaToken.balanceOf(user1.address)).to.eq(poolAlpa);

        /**
         * deposit 0 to trigger reward
         */
        await masterchefFromUser1.deposit(poolID, 0);

        pool = await masterChef.poolInfo(poolID);
        expect(pool.accShare).to.eq(alpacaEnergy.mul(depositLPAmount));

        info = await masterChef.userInfo(poolID, user1.address);
        expect(info.amount).to.eq(depositLPAmount.toString());

        expect(await alpaToken.balanceOf(user1.address)).to.eq(
          poolAlpa.mul(2)
        );
      });
    });
  });

  context("With one lp pool and two user", async () => {
    const POOL_ALLOCATION_POINT = 100;
    const poolID = 0;
    let lpToken: Contract;

    beforeEach(async () => {
      lpToken = await deployContract(owner, AlpaToken);
      await masterChef.add(POOL_ALLOCATION_POINT, lpToken.address, false);
    });

    context("with no alpaca", async () => {
      context("with equal amount of lp deposit", async () => {
        const depositLPAmount = BigNumber.from(10000);

        beforeEach(async () => {
          await lpToken.mint(user1.address, depositLPAmount.toString());

          const lpTokenFromUser1 = lpToken.connect(user1);
          await lpTokenFromUser1.approve(
            masterChef.address,
            depositLPAmount.toString()
          );

          await lpToken.mint(user2.address, depositLPAmount.toString());

          const lpTokenFromUser2 = lpToken.connect(user2);
          await lpTokenFromUser2.approve(
            masterChef.address,
            depositLPAmount.toString()
          );
        });

        it("recievs correct reward", async () => {
          /**
           * User 1 deposit
           */
          const masterchefFromUser1 = masterChef.connect(user1);
          await masterchefFromUser1.deposit(poolID, depositLPAmount.toString());

          expect(await lpToken.balanceOf(masterChef.address)).to.eq(
            depositLPAmount
          );

          let pool = await masterChef.poolInfo(poolID);
          expect(pool.accAlpaPerShare).to.eq(0);
          expect(pool.accShare).to.eq(EMPTY_ALPACA_ENERGY.mul(depositLPAmount));

          let info = await masterChef.userInfo(poolID, user1.address);
          expect(info.amount).to.eq(depositLPAmount);
          expect(info.rewardDebt).to.eq(0);

          let globalInfo = await masterChef.userGlobalInfo(user1.address);
          expect(globalInfo.alpacaID).to.eq(0);
          expect(globalInfo.alpacaEnergy).to.eq(0);

          /**
           * User 2 deposit
           */
          const {poolAlpa, devAlpa, communityAlpa} = mintedAlpa(1);
          const masterchefFromUser2 = masterChef.connect(user2);
          await expect(
            masterchefFromUser2.deposit(poolID, depositLPAmount.toString())
          )
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, dev.address, devAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, community.address, communityAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, masterChef.address, poolAlpa);

          expect(await lpToken.balanceOf(masterChef.address)).to.eq(
            depositLPAmount.add(depositLPAmount)
          );

          const share = poolAlpa.mul(PER_SHARE_MULTIPLIER).div(
            depositLPAmount.mul(EMPTY_ALPACA_ENERGY)
          );
          pool = await masterChef.poolInfo(poolID);
          expect(pool.accAlpaPerShare).to.eq(share);
          expect(pool.accShare).to.eq(
            depositLPAmount.mul(EMPTY_ALPACA_ENERGY).mul(2)
          );

          info = await masterChef.userInfo(poolID, user2.address);
          expect(info.amount).to.eq(depositLPAmount);

          const debt = depositLPAmount
            .mul(EMPTY_ALPACA_ENERGY)
            .mul(share)
            .div(PER_SHARE_MULTIPLIER);
          expect(info.rewardDebt).to.eq(debt);

          globalInfo = await masterChef.userGlobalInfo(user2.address);
          expect(globalInfo.alpacaID).to.eq(0);
          expect(globalInfo.alpacaEnergy).to.eq(0);

          /**
           * User 1 deposit 0 amount
           * Two block has passed:
           *    first block  - user1 should receive full block reward
           *    second block - user1 should receive half block reward give user2 entered with same amount
           */
          await expect(masterchefFromUser1.deposit(poolID, 0))
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, dev.address, devAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, community.address, communityAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, masterChef.address, poolAlpa);

          expect(await alpaToken.balanceOf(user1.address)).to.eq(
            poolAlpa.add(poolAlpa.div(2))
          );

          /**
           * User 2 deposit 0 amount
           * three block has passed:
           *    first block  - user2 should receive none of the block reward
           *    second block - user2 should receive half block reward give user2 entered with same amount
           *    third block - user2 should receive half block reward
           */
          await masterchefFromUser2.deposit(poolID, 0);
          expect(await alpaToken.balanceOf(user2.address)).to.eq(poolAlpa);

          /**
           * User 1 deposit 0 amount
           * Two block has passed:
           *    first block  - user1 should receive full block reward
           *    second block - user1 should receive half block reward give user2 entered with same amount
           */
          await expect(masterchefFromUser1.deposit(poolID, 0))
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, dev.address, devAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, community.address, communityAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, masterChef.address, poolAlpa);
            
          expect(await alpaToken.balanceOf(user1.address)).to.eq(
            poolAlpa.add(poolAlpa).add(poolAlpa.div(2))
          );

          /**
           * User 2 deposit 0 amount
           * three block has passed:
           *    first block  - user2 should receive none of the block reward
           *    second block - user2 should receive half block reward give user2 entered with same amount
           *    third block - user2 should receive half block reward
           */
          await masterchefFromUser2.deposit(poolID, 0);
          expect(await alpaToken.balanceOf(user2.address)).to.eq(
            poolAlpa.add(poolAlpa)
          );
        });
      });

      context("with different amount of lp deposit", async () => {
        const deposit1LPAmount = BigNumber.from(10000);
        const deposit2LPAmount = BigNumber.from(30000);

        beforeEach(async () => {
          await lpToken.mint(user1.address, deposit1LPAmount.toString());

          const lpTokenFromUser1 = lpToken.connect(user1);
          await lpTokenFromUser1.approve(
            masterChef.address,
            deposit1LPAmount.toString()
          );

          await lpToken.mint(user2.address, deposit2LPAmount.toString());

          const lpTokenFromUser2 = lpToken.connect(user2);
          await lpTokenFromUser2.approve(
            masterChef.address,
            deposit2LPAmount.toString()
          );
        });

        it("recievs correct reward", async () => {
          const {poolAlpa, devAlpa, communityAlpa} = mintedAlpa(1);

          /**
           * User 1 deposit
           */
          const masterchefFromUser1 = masterChef.connect(user1);
          await masterchefFromUser1.deposit(
            poolID,
            deposit1LPAmount.toString()
          );

          expect(await lpToken.balanceOf(masterChef.address)).to.eq(
            deposit1LPAmount
          );

          let pool = await masterChef.poolInfo(poolID);
          expect(pool.accAlpaPerShare).to.eq(0);
          expect(pool.accShare).to.eq(
            EMPTY_ALPACA_ENERGY.mul(deposit1LPAmount)
          );

          let info = await masterChef.userInfo(poolID, user1.address);
          expect(info.amount).to.eq(deposit1LPAmount);
          expect(info.rewardDebt).to.eq(0);

          let globalInfo = await masterChef.userGlobalInfo(user1.address);
          expect(globalInfo.alpacaID).to.eq(0);
          expect(globalInfo.alpacaEnergy).to.eq(0);

          /**
           * User 2 deposit
           */
          const masterchefFromUser2 = masterChef.connect(user2);
          await expect(
            masterchefFromUser2.deposit(poolID, deposit2LPAmount.toString())
          )
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, dev.address, devAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, community.address, communityAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, masterChef.address, poolAlpa);

          expect(await lpToken.balanceOf(masterChef.address)).to.eq(
            deposit1LPAmount.add(deposit2LPAmount)
          );

          const share = poolAlpa.mul(PER_SHARE_MULTIPLIER).div(
            deposit1LPAmount.mul(EMPTY_ALPACA_ENERGY)
          );
          pool = await masterChef.poolInfo(poolID);
          expect(pool.accAlpaPerShare).to.eq(share);
          expect(pool.accShare).to.eq(
            deposit1LPAmount
              .mul(EMPTY_ALPACA_ENERGY)
              .add(deposit2LPAmount.mul(EMPTY_ALPACA_ENERGY))
          );

          info = await masterChef.userInfo(poolID, user2.address);
          expect(info.amount).to.eq(deposit2LPAmount);

          const debt = deposit2LPAmount
            .mul(EMPTY_ALPACA_ENERGY)
            .mul(share)
            .div(PER_SHARE_MULTIPLIER);
          expect(info.rewardDebt).to.eq(debt);

          globalInfo = await masterChef.userGlobalInfo(user2.address);
          expect(globalInfo.alpacaID).to.eq(0);
          expect(globalInfo.alpacaEnergy).to.eq(0);

          /**
           * User 1 deposit 0 amount
           * Two block has passed:
           *    first block  - user1 should receive full block reward
           *    second block - user1 should receive 1 third block reward give user2 entered with 3 times the user1 amount
           */
          await expect(masterchefFromUser1.deposit(poolID, 0))
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, dev.address, devAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, community.address, communityAlpa)
            .to.emit(alpaToken, "Transfer")
            .withArgs(ZERO_ADDRESS, masterChef.address, poolAlpa);

          expect(await alpaToken.balanceOf(user1.address)).to.eq(
            poolAlpa.add(poolAlpa.div(4))
          );

          /**
           * User 2 deposit 0 amount
           * three block has passed:
           *    first block  - user2 should receive none of the block reward
           *    second block - user2 should receive 3/4 block reward give user2 entered with 3 times amount of user1
           *    third block - user2 should receive 3/3 block reward
           */
          await masterchefFromUser2.deposit(poolID, 0);
          expect(await alpaToken.balanceOf(user2.address)).to.eq(
            poolAlpa.add(poolAlpa.div(2))
          );
        });
      });
    });

    context("with no alpaca, then transfer alpaca", async () => {
      context(
        "with equal amount of lp deposit, different amount of energy",
        async () => {
          let testAlpaca1: ContractAlpaca;
          const alpacaEnergy1 = BigNumber.from(500);
          const depositLPAmount1 = BigNumber.from(10000);

          let testAlpaca2: ContractAlpaca;
          const alpacaEnergy2 = BigNumber.from(1500);
          const depositLPAmount2 = BigNumber.from(10000);

          beforeEach(async () => {
            await lpToken.mint(user1.address, depositLPAmount1.toString());

            const lpTokenFromUser1 = lpToken.connect(user1);
            await lpTokenFromUser1.approve(
              masterChef.address,
              depositLPAmount1.toString()
            );

            await lpToken.mint(user2.address, depositLPAmount2.toString());

            const lpTokenFromUser2 = lpToken.connect(user2);
            await lpTokenFromUser2.approve(
              masterChef.address,
              depositLPAmount2.toString()
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy1,
              user1.address
            );
            testAlpaca1 = (await alpaca.getAlpaca(1)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user1.address, testAlpaca1.id)).to.eq(
              1
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy2,
              user2.address
            );
            testAlpaca2 = (await alpaca.getAlpaca(2)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user2.address, testAlpaca2.id)).to.eq(
              1
            );
          });

          it("recievs correct reward", async () => {
            const {poolAlpa} = mintedAlpa(1);

            /**
             * user1 deposit
             */
            const masterchefFromUser1 = masterChef.connect(user1);
            await masterchefFromUser1.deposit(
              poolID,
              depositLPAmount1.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount1
            );

            /**
             * user2 deposit
             */
            const masterchefFromUser2 = masterChef.connect(user2);
            await masterchefFromUser2.deposit(
              poolID,
              depositLPAmount2.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount2.add(depositLPAmount1)
            );

            /**
             * user1 transfer alpaca
             */
            const alpacaFromUser1 = alpaca.connect(user1);
            await alpacaFromUser1.safeTransferFrom(
              user1.address,
              masterChef.address,
              testAlpaca1.id,
              1,
              "0x00"
            );
            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              poolAlpa.mul(3).div(2)
            );

            /**
             * user2 transfer alpaca
             */
            const alpacaFromUser2 = alpaca.connect(user2);
            await alpacaFromUser2.safeTransferFrom(
              user2.address,
              masterChef.address,
              testAlpaca2.id,
              1,
              "0x00"
            );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              poolAlpa.div(2).add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              )
            );

            /**
             * deposit 0 to trigger user1 reward
             */
            await masterchefFromUser1.deposit(poolID, 0);
            let expectedBalance = poolAlpa.mul(7)
              .div(4)
              .add(
                poolAlpa.mul(depositLPAmount1)
                  .mul(alpacaEnergy1)
                  .div(
                    depositLPAmount1
                      .mul(alpacaEnergy1)
                      .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                  )
              );
            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalance
            );

            /**
             * deposit 0 to trigger user2 reward
             */
            await masterchefFromUser2.deposit(poolID, 0);
            expectedBalance = poolAlpa.mul(2).add(
              poolAlpa.mul(depositLPAmount2)
                .mul(EMPTY_ALPACA_ENERGY)
                .div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
            );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalance
            );
          });
        }
      );
    });

    context("retrieve", async () => {
      context(
        "with different amount of lp deposit, different amount of energy",
        async () => {
          let testAlpaca1: ContractAlpaca;
          const alpacaEnergy1 = BigNumber.from(500);
          const depositLPAmount1 = BigNumber.from(10000);

          let testAlpaca2: ContractAlpaca;
          const alpacaEnergy2 = BigNumber.from(1500);
          const depositLPAmount2 = BigNumber.from(30000);

          beforeEach(async () => {
            await lpToken.mint(user1.address, depositLPAmount1.toString());

            const lpTokenFromUser1 = lpToken.connect(user1);
            await lpTokenFromUser1.approve(
              masterChef.address,
              depositLPAmount1.toString()
            );

            await lpToken.mint(user2.address, depositLPAmount2.toString());

            const lpTokenFromUser2 = lpToken.connect(user2);
            await lpTokenFromUser2.approve(
              masterChef.address,
              depositLPAmount2.toString()
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy1,
              user1.address
            );
            testAlpaca1 = (await alpaca.getAlpaca(1)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user1.address, testAlpaca1.id)).to.eq(
              1
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy2,
              user2.address
            );
            testAlpaca2 = (await alpaca.getAlpaca(2)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user2.address, testAlpaca2.id)).to.eq(
              1
            );
          });

          it("recievs correct reward", async () => {
            const {poolAlpa} = mintedAlpa(1);

            /**
             * user1 deposit
             */
            const masterchefFromUser1 = masterChef.connect(user1);
            await masterchefFromUser1.deposit(
              poolID,
              depositLPAmount1.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount1
            );

            /**
             * user2 deposit
             */
            const masterchefFromUser2 = masterChef.connect(user2);
            await masterchefFromUser2.deposit(
              poolID,
              depositLPAmount2.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount2.add(depositLPAmount1)
            );

            /**
             * user1 transfer alpaca
             */
            const alpacaFromUser1 = alpaca.connect(user1);
            await alpacaFromUser1.safeTransferFrom(
              user1.address,
              masterChef.address,
              testAlpaca1.id,
              1,
              "0x00"
            );
            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              poolAlpa.mul(5).div(4)
            );

            /**
             * user2 transfer alpaca
             */
            const alpacaFromUser2 = alpaca.connect(user2);
            await alpacaFromUser2.safeTransferFrom(
              user2.address,
              masterChef.address,
              testAlpaca2.id,
              1,
              "0x00"
            );
            const expectedBalanceBlockFour = poolAlpa.div(4)
              .mul(3)
              .add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              );
            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockFour
            );

            /**
             * user 1 retrieve
             */
            await masterchefFromUser1.retrieve();
            const expectedBalanceBlockFive = poolAlpa.mul(135)
              .div(100)
              .add(
                poolAlpa.mul(depositLPAmount1)
                  .mul(alpacaEnergy1)
                  .div(
                    depositLPAmount1
                      .mul(alpacaEnergy1)
                      .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                  )
              );
            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalanceBlockFive
            );

            /**
             * user2 retrieve
             */
            await masterchefFromUser2.retrieve();
            const expectedBalanceBlockSix = poolAlpa.mul(9)
              .div(10)
              .add(
                poolAlpa.mul(depositLPAmount2)
                  .mul(alpacaEnergy2)
                  .div(
                    depositLPAmount1
                      .mul(EMPTY_ALPACA_ENERGY)
                      .add(depositLPAmount2.mul(alpacaEnergy2))
                  )
              )
              .add(expectedBalanceBlockFour);
            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockSix
            );

            /**
             * user1 claim
             */
            await masterchefFromUser1.deposit(poolID, 0);
            const expectedBalanceBlockSev = poolAlpa
              .div(4)
              .add(expectedBalanceBlockFive)
              .add(
                poolAlpa.mul(depositLPAmount1)
                  .mul(EMPTY_ALPACA_ENERGY)
                  .div(
                    depositLPAmount1
                      .mul(EMPTY_ALPACA_ENERGY)
                      .add(depositLPAmount2.mul(alpacaEnergy2))
                  )
              );

            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalanceBlockSev
            );

            /**
             * user2 claim
             */
            await masterchefFromUser2.deposit(poolID, 0);
            const expectedBalanceBlockEight = poolAlpa
              .add(poolAlpa.div(2))
              .add(expectedBalanceBlockSix);
            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockEight
            );
          });
        }
      );
    });

    context("withdrawal", async () => {
      context(
        "with different amount of lp deposit, different amount of energy",
        async () => {
          let testAlpaca1: ContractAlpaca;
          const alpacaEnergy1 = BigNumber.from(500);
          const depositLPAmount1 = BigNumber.from(10000);
          const withdrawLPAmount1 = BigNumber.from(5000);

          let testAlpaca2: ContractAlpaca;
          const alpacaEnergy2 = BigNumber.from(1500);
          const depositLPAmount2 = BigNumber.from(30000);

          beforeEach(async () => {
            await lpToken.mint(user1.address, depositLPAmount1.toString());

            const lpTokenFromUser1 = lpToken.connect(user1);
            await lpTokenFromUser1.approve(
              masterChef.address,
              depositLPAmount1.toString()
            );

            await lpToken.mint(user2.address, depositLPAmount2.toString());

            const lpTokenFromUser2 = lpToken.connect(user2);
            await lpTokenFromUser2.approve(
              masterChef.address,
              depositLPAmount2.toString()
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy1,
              user1.address
            );
            testAlpaca1 = (await alpaca.getAlpaca(1)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user1.address, testAlpaca1.id)).to.eq(
              1
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy2,
              user2.address
            );
            testAlpaca2 = (await alpaca.getAlpaca(2)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user2.address, testAlpaca2.id)).to.eq(
              1
            );
          });

          it("recievs correct reward", async () => {
            const {poolAlpa} = mintedAlpa(1);

            /**
             * user1 deposit
             */
            const masterchefFromUser1 = masterChef.connect(user1);
            await masterchefFromUser1.deposit(
              poolID,
              depositLPAmount1.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount1
            );

            /**
             * user2 deposit
             */
            const masterchefFromUser2 = masterChef.connect(user2);
            await masterchefFromUser2.deposit(
              poolID,
              depositLPAmount2.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount2.add(depositLPAmount1)
            );

            /**
             * user1 transfer alpaca
             */
            const alpacaFromUser1 = alpaca.connect(user1);
            await alpacaFromUser1.safeTransferFrom(
              user1.address,
              masterChef.address,
              testAlpaca1.id,
              1,
              "0x00"
            );
            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              poolAlpa.mul(5).div(4)
            );

            /**
             * user1 withdraw
             */
            await masterchefFromUser1.withdraw(poolID, withdrawLPAmount1);

            const expectecBalanceBlockFour = poolAlpa.mul(5)
              .div(4)
              .add(
                poolAlpa.mul(depositLPAmount1)
                  .mul(alpacaEnergy1)
                  .div(
                    depositLPAmount1
                      .mul(alpacaEnergy1)
                      .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                  )
              );

            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectecBalanceBlockFour
            );

            /**
             * user1 withdraw again
             */
            await masterchefFromUser1.withdraw(poolID, withdrawLPAmount1);
            const expectedBalanceBlockFive = poolAlpa.mul(5)
              .div(4)
              .add(
                poolAlpa.mul(depositLPAmount1)
                  .mul(alpacaEnergy1)
                  .div(
                    depositLPAmount1
                      .mul(alpacaEnergy1)
                      .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                  )
                  .add(
                    poolAlpa.mul(depositLPAmount1.sub(withdrawLPAmount1))
                      .mul(alpacaEnergy1)
                      .div(
                        depositLPAmount1
                          .sub(withdrawLPAmount1)
                          .mul(alpacaEnergy1)
                          .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                      )
                  )
              );

            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalanceBlockFive
            );

            /**
             * user2 claim
             */
            await masterchefFromUser2.deposit(poolID, 0);
            const expectedBalanceBlockSix = poolAlpa.mul(7)
              .div(4)
              .add(
                poolAlpa.mul(depositLPAmount2)
                  .mul(EMPTY_ALPACA_ENERGY)
                  .div(
                    depositLPAmount1
                      .mul(alpacaEnergy1)
                      .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                  )
                  .add(
                    poolAlpa.mul(
                      depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                    ).div(
                      depositLPAmount1
                        .sub(withdrawLPAmount1)
                        .mul(alpacaEnergy1)
                        .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                    )
                  )
              );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockSix
            );
          });
        }
      );
    });

    context("swap with lower", async () => {
      context(
        "with equal amount of lp deposit, different amount of energy",
        async () => {
          let testAlpaca1: ContractAlpaca;
          const alpacaEnergy1 = BigNumber.from(500);
          const depositLPAmount1 = BigNumber.from(10000);

          let testAlpaca2: ContractAlpaca;
          let testAlpaca3: ContractAlpaca;
          const alpacaEnergy2 = BigNumber.from(1500);
          const alpacaEnergy2_new = BigNumber.from(300);
          const depositLPAmount2 = BigNumber.from(10000);

          beforeEach(async () => {
            await lpToken.mint(user1.address, depositLPAmount1.toString());

            const lpTokenFromUser1 = lpToken.connect(user1);
            await lpTokenFromUser1.approve(
              masterChef.address,
              depositLPAmount1.toString()
            );

            await lpToken.mint(user2.address, depositLPAmount2.toString());

            const lpTokenFromUser2 = lpToken.connect(user2);
            await lpTokenFromUser2.approve(
              masterChef.address,
              depositLPAmount2.toString()
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy1,
              user1.address
            );
            testAlpaca1 = (await alpaca.getAlpaca(1)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user1.address, testAlpaca1.id)).to.eq(
              1
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy2,
              user2.address
            );
            testAlpaca2 = (await alpaca.getAlpaca(2)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user2.address, testAlpaca2.id)).to.eq(
              1
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy2_new,
              user2.address
            );
            testAlpaca3 = (await alpaca.getAlpaca(3)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user2.address, testAlpaca3.id)).to.eq(
              1
            );
          });

          it("recievs correct reward", async () => {
            const {poolAlpa} = mintedAlpa(1);

            /**
             * user1 deposit
             */
            const masterchefFromUser1 = masterChef.connect(user1);
            await masterchefFromUser1.deposit(
              poolID,
              depositLPAmount1.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount1
            );

            /**
             * user2 deposit
             */
            const masterchefFromUser2 = masterChef.connect(user2);
            await masterchefFromUser2.deposit(
              poolID,
              depositLPAmount2.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount2.add(depositLPAmount1)
            );

            /**
             * user1 transfer alpaca
             */
            const alpacaFromUser1 = alpaca.connect(user1);
            await alpacaFromUser1.safeTransferFrom(
              user1.address,
              masterChef.address,
              testAlpaca1.id,
              1,
              "0x00"
            );
            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              poolAlpa.mul(3).div(2)
            );

            /**
             * user2 transfer alpaca
             */
            const alpacaFromUser2 = alpaca.connect(user2);
            await alpacaFromUser2.safeTransferFrom(
              user2.address,
              masterChef.address,
              testAlpaca2.id,
              1,
              "0x00"
            );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              poolAlpa.div(2).add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              )
            );

            /**
             * deposit 0 to trigger user2 reward
             */
            await masterchefFromUser2.deposit(poolID, 0);
            const expectedBalanceBlockFive = poolAlpa.mul(5)
              .div(4)
              .add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockFive
            );

            /**
             * deposit 0 to trigger user1 reward
             */
            await masterchefFromUser1.deposit(poolID, 0);
            const expectedBalanceBlockSix = poolAlpa.mul(2).add(
              poolAlpa.mul(depositLPAmount1.mul(alpacaEnergy1)).div(
                depositLPAmount1
                  .mul(alpacaEnergy1)
                  .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
              )
            );

            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalanceBlockSix
            );

            /**
             * User 2 swap with lower energy Alpaca
             */
            await alpacaFromUser2.safeTransferFrom(
              user2.address,
              masterChef.address,
              testAlpaca3.id,
              1,
              "0x00"
            );

            const expectedBalanceBlockSeven = poolAlpa.mul(11)
              .div(4)
              .add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockSeven
            );

            /**
             * deposit 0 to trigger user1 reward
             */
            await masterchefFromUser1.deposit(poolID, 0);
            const expectedBalanceBlockEight = poolAlpa.mul(9)
              .div(4)
              .add(
                poolAlpa.mul(depositLPAmount1.mul(alpacaEnergy1)).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              )
              .add(
                poolAlpa.mul(depositLPAmount1.mul(alpacaEnergy1)).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(alpacaEnergy2_new))
                )
              );

            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalanceBlockEight
            );

            /**
             * deposit 0 to trigger user2 reward
             */
            await masterchefFromUser2.deposit(poolID, 0);
            const expectedBalanceBlockNine = poolAlpa.mul(7)
              .div(2)
              .add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockNine
            );
          });
        }
      );
    });

    context("swap with higher", async () => {
      context(
        "with equal amount of lp deposit, different amount of energy",
        async () => {
          let testAlpaca1: ContractAlpaca;
          let testAlpaca3: ContractAlpaca;
          const alpacaEnergy1 = BigNumber.from(500);
          const alpacaEnergy1_new = BigNumber.from(1000);
          const depositLPAmount1 = BigNumber.from(10000);

          let testAlpaca2: ContractAlpaca;
          const alpacaEnergy2 = BigNumber.from(1500);
          const depositLPAmount2 = BigNumber.from(10000);

          beforeEach(async () => {
            await lpToken.mint(user1.address, depositLPAmount1.toString());

            const lpTokenFromUser1 = lpToken.connect(user1);
            await lpTokenFromUser1.approve(
              masterChef.address,
              depositLPAmount1.toString()
            );

            await lpToken.mint(user2.address, depositLPAmount2.toString());

            const lpTokenFromUser2 = lpToken.connect(user2);
            await lpTokenFromUser2.approve(
              masterChef.address,
              depositLPAmount2.toString()
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy1,
              user1.address
            );
            testAlpaca1 = (await alpaca.getAlpaca(1)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user1.address, testAlpaca1.id)).to.eq(
              1
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy2,
              user2.address
            );
            testAlpaca2 = (await alpaca.getAlpaca(2)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user2.address, testAlpaca2.id)).to.eq(
              1
            );

            await alpaca.createGen0Alpaca(
              "620662782354206032694144109774754641861551612911987663939884",
              alpacaEnergy1_new,
              user1.address
            );
            testAlpaca3 = (await alpaca.getAlpaca(3)) as ContractAlpaca;
            expect(await alpaca.balanceOf(user1.address, testAlpaca3.id)).to.eq(
              1
            );
          });

          it("recievs correct reward", async () => {
            const {poolAlpa} = mintedAlpa(1);

            /**
             * user1 deposit
             */
            const masterchefFromUser1 = masterChef.connect(user1);
            await masterchefFromUser1.deposit(
              poolID,
              depositLPAmount1.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount1
            );

            /**
             * user2 deposit
             */
            const masterchefFromUser2 = masterChef.connect(user2);
            await masterchefFromUser2.deposit(
              poolID,
              depositLPAmount2.toString()
            );

            expect(await lpToken.balanceOf(masterChef.address)).to.eq(
              depositLPAmount2.add(depositLPAmount1)
            );

            /**
             * user1 transfer alpaca
             */
            const alpacaFromUser1 = alpaca.connect(user1);
            await alpacaFromUser1.safeTransferFrom(
              user1.address,
              masterChef.address,
              testAlpaca1.id,
              1,
              "0x00"
            );
            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              poolAlpa.mul(3).div(2)
            );

            /**
             * user2 transfer alpaca
             */
            const alpacaFromUser2 = alpaca.connect(user2);
            await alpacaFromUser2.safeTransferFrom(
              user2.address,
              masterChef.address,
              testAlpaca2.id,
              1,
              "0x00"
            );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              poolAlpa.div(2).add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              )
            );

            /**
             * deposit 0 to trigger user2 reward
             */
            await masterchefFromUser2.deposit(poolID, 0);
            const expectedBalanceBlockFive = poolAlpa.mul(5)
              .div(4)
              .add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockFive
            );

            /**
             * deposit 0 to trigger user1 reward
             */
            await masterchefFromUser1.deposit(poolID, 0);
            const expectedBalanceBlockSix = poolAlpa.mul(2).add(
              poolAlpa.mul(depositLPAmount1.mul(alpacaEnergy1)).div(
                depositLPAmount1
                  .mul(alpacaEnergy1)
                  .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
              )
            );

            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalanceBlockSix
            );

            /**
             * User 1 swap with lower energy Alpaca
             */
            await alpacaFromUser1.safeTransferFrom(
              user1.address,
              masterChef.address,
              testAlpaca3.id,
              1,
              "0x00"
            );

            const expectedBalanceBlockSeven = poolAlpa.mul(9)
              .div(4)
              .add(
                poolAlpa.mul(depositLPAmount1.mul(alpacaEnergy1)).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              );

            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalanceBlockSeven
            );

            /**
             * deposit 0 to trigger user1 reward
             */
            await masterchefFromUser1.deposit(poolID, 0);
            const expectedBalanceBlockEight = poolAlpa.mul(53)
              .div(20)
              .add(
                poolAlpa.mul(depositLPAmount1.mul(alpacaEnergy1)).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              );

            expect(await alpaToken.balanceOf(user1.address)).to.eq(
              expectedBalanceBlockEight
            );

            /**
             * deposit 0 to trigger user2 reward
             */
            await masterchefFromUser2.deposit(poolID, 0);
            const expectedBalanceBlockNine = poolAlpa.mul(79)
              .div(20)
              .add(
                poolAlpa.mul(
                  depositLPAmount2.mul(EMPTY_ALPACA_ENERGY)
                ).div(
                  depositLPAmount1
                    .mul(alpacaEnergy1)
                    .add(depositLPAmount2.mul(EMPTY_ALPACA_ENERGY))
                )
              );

            expect(await alpaToken.balanceOf(user2.address)).to.eq(
              expectedBalanceBlockNine
            );
          });
        }
      );
    });
  });
});
