import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { arrayify } from "ethers/lib/utils";
import { ethers, network } from "hardhat";

import { merkleTree } from "./utils/criteria";
import {
  buildResolver,
  getItemETH,
  randomHex,
  toAddress,
  toBN,
  toFulfillment,
  toKey,
} from "./utils/encoding";
import { decodeEvents } from "./utils/events";
import { faucet } from "./utils/faucet";
import { seaportFixture } from "./utils/fixtures";
import { VERSION } from "./utils/helpers";

import type {
  ConsiderationInterface,
  ImmutableZone,
  ImmutableZoneController,
  TestERC721,
  TestZone,
} from "../typechain-types";
import type { SeaportFixtures } from "./utils/fixtures";
import type { Contract, Wallet } from "ethers";

const { parseEther } = ethers.utils;

describe(`Zone - ImmutableZone (Seaport v${VERSION})`, function () {
  const { provider } = ethers;
  const owner = new ethers.Wallet(randomHex(32), provider);
  const immutableSigner = new ethers.Wallet(randomHex(32), provider);

  let marketplaceContract: ConsiderationInterface;
  let stubZone: TestZone;
  let testERC721: TestERC721;
  let immutableZoneController: ImmutableZoneController;
  let immutableZone: ImmutableZone;
  const salt = randomHex();

  let checkExpectedEvents: SeaportFixtures["checkExpectedEvents"];
  let createOrder: SeaportFixtures["createOrder"];
  let getTestItem721: SeaportFixtures["getTestItem721"];
  let getTestItem721WithCriteria: SeaportFixtures["getTestItem721WithCriteria"];
  let mintAndApprove721: SeaportFixtures["mintAndApprove721"];
  let withBalanceChecks: SeaportFixtures["withBalanceChecks"];

  after(async () => {
    await network.provider.request({
      method: "hardhat_reset",
    });
  });

  before(async () => {
    await faucet(owner.address, provider);

    ({
      checkExpectedEvents,
      createOrder,
      getTestItem721,
      getTestItem721WithCriteria,
      marketplaceContract,
      mintAndApprove721,
      stubZone,
      testERC721,
      withBalanceChecks,
    } = await seaportFixture(owner));
  });

  let buyer: Wallet;
  let seller: Wallet;

  async function setupFixture() {
    // Setup basic buyer/seller wallets with ETH
    const seller = new ethers.Wallet(randomHex(32), provider);
    const buyer = new ethers.Wallet(randomHex(32), provider);

    for (const wallet of [seller, buyer]) {
      await faucet(wallet.address, provider);
    }

    // deploy zone controller
    const ImmutableZoneController = await ethers.getContractFactory(
      "ImmutableZoneController",
      owner
    );
    const immutableZoneController = await ImmutableZoneController.deploy(
      owner.address
    );
    // deploy zone
    const immutableZone = await createZone(immutableZoneController, salt);
    // set immutable signer as operator
    await immutableZoneController
      .connect(owner)
      .assignOperator(immutableZone.address, immutableSigner.address);

    return { seller, buyer, immutableZoneController, immutableZone };
  }

  beforeEach(async () => {
    ({ seller, buyer, immutableZoneController, immutableZone } =
      await loadFixture(setupFixture));
  });

  /** Create zone and get zone contract */
  async function createZone(immutableZoneController: Contract, salt?: string) {
    const tx = await immutableZoneController.createZone(salt ?? randomHex());

    const zoneContract = await ethers.getContractFactory(
      "ImmutableZone",
      owner
    );

    const events = await decodeEvents(tx, [
      { eventName: "ZoneCreated", contract: immutableZoneController },
      { eventName: "Unpaused", contract: zoneContract as any },
    ]);
    expect(events.length).to.be.equal(2);

    const [unpauseEvent, zoneCreatedEvent] = events;
    expect(unpauseEvent.eventName).to.equal("Unpaused");
    expect(zoneCreatedEvent.eventName).to.equal("ZoneCreated");

    return zoneContract.attach(zoneCreatedEvent.data.zone as string);
  }

  describe("Order fulfillment", () => {
    it("Seaport can fulfill an Immutable-signed advanced order", async () => {
      // create basic order using ImmutableZone as zone
      // execute basic 721 <=> ETH order
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );
      const offer = [getTestItem721(nftId)];
      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];
      const { order, orderHash, value } = await createOrder(
        seller,
        immutableZone,
        offer,
        consideration,
        2 // FULL_RESTRICTED
      );

      // sign the orderHash with immutableSigner
      order.extraData = await immutableSigner.signMessage(arrayify(orderHash));

      await withBalanceChecks([order], 0, undefined, async () => {
        const tx = await marketplaceContract
          .connect(buyer)
          .fulfillAdvancedOrder(
            order,
            [],
            toKey(0),
            ethers.constants.AddressZero,
            {
              value,
            }
          );

        const receipt = await tx.wait();
        await checkExpectedEvents(tx, receipt, [
          {
            order,
            orderHash,
            fulfiller: buyer.address,
            fulfillerConduitKey: toKey(0),
          },
        ]);
        return receipt;
      });
    });

    it("Seaport can fulfill an Immutable-signed advanced order with criteria", async () => {
      // create basic order using immutable zone
      // execute basic 721 <=> ETH order
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );

      const { root, proofs } = merkleTree([nftId]);

      const offer = [getTestItem721WithCriteria(root, toBN(1), toBN(1))];

      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];

      const criteriaResolvers = [
        buildResolver(0, 0, 0, nftId, proofs[nftId.toString()]),
      ];

      const { order, orderHash, value } = await createOrder(
        seller,
        immutableZone,
        offer,
        consideration,
        2, // FULL_RESTRICTED
        criteriaResolvers
      );

      // sign the orderHash with immutableSigner
      order.extraData = await immutableSigner.signMessage(arrayify(orderHash));

      await withBalanceChecks([order], 0, criteriaResolvers, async () => {
        const tx = await marketplaceContract
          .connect(buyer)
          .fulfillAdvancedOrder(
            order,
            criteriaResolvers,
            toKey(0),
            ethers.constants.AddressZero,
            {
              value,
            }
          );

        const receipt = await tx.wait();
        await checkExpectedEvents(
          tx,
          receipt,
          [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
              fulfillerConduitKey: toKey(0),
            },
          ],
          undefined,
          criteriaResolvers
        );
        return receipt;
      });
    });

    it("Seaport can fulfill an Immutable-signed partial restricted advanced order", async () => {
      // execute basic 721 <=> ETH order
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );

      const offer = [getTestItem721(nftId)];

      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];

      const { order, orderHash, value } = await createOrder(
        seller,
        immutableZone,
        offer,
        consideration,
        3 // PARTIAL_RESTRICTED
      );

      // sign the orderHash with immutableSigner
      order.extraData = await immutableSigner.signMessage(arrayify(orderHash));

      await withBalanceChecks([order], 0, undefined, async () => {
        const tx = await marketplaceContract
          .connect(buyer)
          .fulfillAdvancedOrder(
            order,
            [],
            toKey(0),
            ethers.constants.AddressZero,
            {
              value,
            }
          );

        const receipt = await tx.wait();
        await checkExpectedEvents(tx, receipt, [
          {
            order,
            orderHash,
            fulfiller: buyer.address,
            fulfillerConduitKey: toKey(0),
          },
        ]);
        return receipt;
      });
    });

    it("ImmutableZone can fulfill an order with executeMatchAdvancedOrders", async () => {
      // Mint NFTs for use in orders
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );
      const secondNFTId = await mintAndApprove721(
        buyer,
        marketplaceContract.address
      );
      const thirdNFTId = await mintAndApprove721(
        owner,
        marketplaceContract.address
      );

      // Define orders
      const offerOne = [
        getTestItem721(nftId, toBN(1), toBN(1), undefined, testERC721.address),
      ];
      const considerationOne = [
        getTestItem721(
          secondNFTId,
          toBN(1),
          toBN(1),
          seller.address,
          testERC721.address
        ),
      ];
      const { order: orderOne, orderHash: orderHashOne } = await createOrder(
        seller,
        immutableZone,
        offerOne,
        considerationOne,
        2
      );
      // sign the orderHash with immutableSigner
      orderOne.extraData = await immutableSigner.signMessage(
        arrayify(orderHashOne)
      );

      const offerTwo = [
        getTestItem721(
          secondNFTId,
          toBN(1),
          toBN(1),
          undefined,
          testERC721.address
        ),
      ];
      const considerationTwo = [
        getTestItem721(
          thirdNFTId,
          toBN(1),
          toBN(1),
          buyer.address,
          testERC721.address
        ),
      ];
      const { order: orderTwo, orderHash: orderHashTwo } = await createOrder(
        buyer,
        immutableZone,
        offerTwo,
        considerationTwo,
        2
      );
      // sign the orderHash with immutableSigner
      orderTwo.extraData = await immutableSigner.signMessage(
        arrayify(orderHashTwo)
      );

      const offerThree = [
        getTestItem721(
          thirdNFTId,
          toBN(1),
          toBN(1),
          undefined,
          testERC721.address
        ),
      ];
      const considerationThree = [
        getTestItem721(
          nftId,
          toBN(1),
          toBN(1),
          owner.address,
          testERC721.address
        ),
      ];
      const { order: orderThree, orderHash: orderHashThree } =
        await createOrder(
          owner,
          immutableZone,
          offerThree,
          considerationThree,
          2
        );
      // sign the orderHash with immutableSigner
      orderThree.extraData = await immutableSigner.signMessage(
        arrayify(orderHashThree)
      );

      const fulfillments = [
        [[[1, 0]], [[0, 0]]],
        [[[0, 0]], [[2, 0]]],
        [[[2, 0]], [[1, 0]]],
      ].map(([offerArr, considerationArr]) =>
        toFulfillment(offerArr, considerationArr)
      );

      await expect(
        immutableZoneController
          .connect(buyer)
          .executeMatchAdvancedOrders(
            immutableZone.address,
            marketplaceContract.address,
            [orderOne, orderTwo, orderThree],
            [],
            fulfillments,
            { value: 0 }
          )
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "CallerIsNotOwner"
      );

      // Ensure that the number of executions from matching advanced orders with zone
      // is equal to the number of fulfillments
      const executions = await immutableZoneController
        .connect(owner)
        .callStatic.executeMatchAdvancedOrders(
          immutableZone.address,
          marketplaceContract.address,
          [orderOne, orderTwo, orderThree],
          [],
          fulfillments,
          { value: 0 }
        );
      expect(executions.length).to.equal(fulfillments.length);

      // Perform the match advanced orders with zone
      const tx = await immutableZoneController
        .connect(owner)
        .executeMatchAdvancedOrders(
          immutableZone.address,
          marketplaceContract.address,
          [orderOne, orderTwo, orderThree],
          [],
          fulfillments
        );

      // Decode all events and get the order hashes
      const orderFulfilledEvents = await decodeEvents(tx, [
        { eventName: "OrderFulfilled", contract: marketplaceContract },
      ]);
      expect(orderFulfilledEvents.length).to.equal(fulfillments.length);

      // Check that the actual order hashes match those from the events, in order
      const actualOrderHashes = [orderHashOne, orderHashTwo, orderHashThree];
      orderFulfilledEvents.forEach((orderFulfilledEvent, i) =>
        expect(orderFulfilledEvent.data.orderHash).to.be.equal(
          actualOrderHashes[i]
        )
      );
    });

    it("Seaport cannot fill a non-Immutable-signed advanced order", async () => {
      // execute basic 721 <=> ETH order
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );
      const offer = [getTestItem721(nftId)];
      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];
      const { order, value } = await createOrder(
        seller,
        immutableZone,
        offer,
        consideration,
        2 // FULL_RESTRICTED
      );

      await expect(
        marketplaceContract
          .connect(buyer)
          .fulfillAdvancedOrder(
            order,
            [],
            toKey(0),
            ethers.constants.AddressZero,
            {
              value,
            }
          )
      ).to.be.revertedWith("ECDSA: invalid signature length");
    });

    it("Seaport cannot fill an advanced order if Immutable signer not set", async () => {
      const unsetSignerImmutableZone = await createZone(
        immutableZoneController
      );

      // execute basic 721 <=> ETH order
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );
      const offer = [getTestItem721(nftId)];
      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];
      const { order, orderHash, value } = await createOrder(
        seller,
        unsetSignerImmutableZone,
        offer,
        consideration,
        2 // FULL_RESTRICTED
      );
      // generate fake modified signature for which ecrecover will return zero address
      const fakeSig = await buyer.signMessage(arrayify(orderHash));
      order.extraData = fakeSig.slice(0, fakeSig.length - 1) + "d";

      await expect(
        marketplaceContract
          .connect(buyer)
          .fulfillAdvancedOrder(
            order,
            [],
            toKey(0),
            ethers.constants.AddressZero,
            {
              value,
            }
          )
      ).to.be.reverted;
    });
  });

  describe("Zone deployment", () => {
    it("Only owner can deploy the zone", async () => {
      // deploy Immutable zone from non-deployer owner
      const salt = randomHex();
      await expect(
        immutableZoneController.connect(seller).createZone(salt)
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "CallerIsNotOwner"
      );

      // deploy Immutable zone from owner
      await createZone(immutableZoneController);
    });

    it("Cannot deploy a zone with the same salt", async () => {
      const salt = randomHex();
      // Create zone with salt
      await immutableZoneController.createZone(salt);

      // Create zone with same salt
      await expect(
        immutableZoneController.createZone(salt)
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "ZoneAlreadyExists"
      );
    });
  });

  describe("Pausable", () => {
    it("Only owner can assign (non-zero) pauser", async () => {
      // Try to pause the zone through the deployer before being assigned pauser
      await expect(
        immutableZoneController.connect(buyer).pause(immutableZone.address)
      ).to.be.reverted;

      // Try to pause the zone directly before being assigned pauser
      await expect(immutableZone.connect(buyer).pause(immutableZone.address)).to
        .be.reverted;

      // Non-owner cannot assign pauser
      await expect(
        immutableZoneController.connect(buyer).assignPauser(seller.address)
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "CallerIsNotOwner"
      );

      // Cannot assign pauser as zero address
      await expect(
        immutableZoneController.connect(owner).assignPauser(toAddress(0))
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "PauserCanNotBeSetAsZero"
      );

      // Owner assigns the pauser of the zone
      await immutableZoneController.connect(owner).assignPauser(buyer.address);

      // Check pauser owner
      expect(await immutableZoneController.pauser()).to.equal(buyer.address);
    });

    it("Owner can pause the zone", async () => {
      // Owner pauses the zone
      const tx = await immutableZoneController
        .connect(owner)
        .pause(immutableZone.address);

      // Check paused event was emitted
      const pauseEvents = await decodeEvents(tx, [
        { eventName: "Paused", contract: immutableZone as any },
      ]);
      expect(pauseEvents.length).to.equal(1);
    });

    it("Pauser can pause the zone", async () => {
      // Owner assigns the pauser of the zone
      await immutableZoneController.connect(owner).assignPauser(buyer.address);

      // Check pauser owner
      expect(await immutableZoneController.pauser()).to.equal(buyer.address);

      // Pauser pauses the zone
      const tx = await immutableZoneController
        .connect(buyer)
        .pause(immutableZone.address);

      // Check paused event was emitted
      const pauseEvents = await decodeEvents(tx, [
        { eventName: "Paused", contract: immutableZone as any },
      ]);
      expect(pauseEvents.length).to.equal(1);
    });

    it("Non-owner or pauser cannot pause the zone", async () => {
      // non owner tries to use pausable deployer to pause the zone, reverts
      await expect(
        immutableZoneController.connect(buyer).pause(immutableZone.address)
      ).to.be.reverted;
    });

    it("Cannot fill order if zone has been pauseed", async () => {
      // execute basic 721 <=> ETH order
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );

      const offer = [getTestItem721(nftId)];

      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];

      // eslint-disable-next-line
      const { order, orderHash, value } = await createOrder(
        seller,
        immutableZone.address,
        offer,
        consideration,
        2
      );
      // sign the orderHash with immutableSigner
      order.extraData = await immutableSigner.signMessage(arrayify(orderHash));

      // owner pauses the zone
      await immutableZoneController.pause(immutableZone.address);

      if (!process.env.REFERENCE) {
        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(0), {
            value,
          })
        )
          .to.be.revertedWithCustomError(
            marketplaceContract,
            "InvalidRestrictedOrder"
          )
          .withArgs(orderHash);
      } else {
        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(0), {
            value,
          })
        ).to.be.reverted;
      }
    });

    it("Only owner can unpause the zone", async () => {
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );
      const offer = [getTestItem721(nftId)];
      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];

      // eslint-disable-next-line
      const { order, orderHash, value } = await createOrder(
        seller,
        immutableZone.address,
        offer,
        consideration,
        2
      );
      // sign the orderHash with immutableSigner
      order.extraData = await immutableSigner.signMessage(arrayify(orderHash));

      // owner pauses the zone
      await immutableZoneController.pause(immutableZone.address);

      // order cannot be filled after zone is paused
      await expect(
        marketplaceContract
          .connect(buyer)
          .fulfillAdvancedOrder(
            order,
            [],
            toKey(0),
            ethers.constants.AddressZero,
            {
              value,
            }
          )
      )
        .to.be.revertedWithCustomError(
          marketplaceContract,
          "InvalidRestrictedOrder"
        )
        .withArgs(orderHash);

      // owner unpauses the zone, redeploying to the same address and setting the same immutable signer
      const redeployedZone = await createZone(immutableZoneController, salt);
      expect(redeployedZone.address).to.equal(immutableZone.address);
      await immutableZoneController.assignOperator(
        redeployedZone.address,
        immutableSigner.address
      );

      // order can be filled after zone is unpaused
      await withBalanceChecks([order], 0, undefined, async () => {
        const tx = await marketplaceContract
          .connect(buyer)
          .fulfillAdvancedOrder(
            order,
            [],
            toKey(0),
            ethers.constants.AddressZero,
            {
              value,
            }
          );

        const receipt = await tx.wait();
        await checkExpectedEvents(tx, receipt, [
          {
            order,
            orderHash,
            fulfiller: buyer.address,
            fulfillerConduitKey: toKey(0),
          },
        ]);
        return receipt;
      });
    });
  });

  describe("Order cancellation", () => {
    it("Only owner can cancel restricted orders through zone controller", async () => {
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );

      const offer = [getTestItem721(nftId)];

      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];

      const { orderHash, orderComponents } = await createOrder(
        seller,
        immutableZone.address,
        offer,
        consideration,
        2 // FULL_RESTRICTED, zone can execute or cancel
      );

      await expect(
        immutableZoneController
          .connect(buyer)
          .cancelOrders(immutableZone.address, marketplaceContract.address, [
            orderComponents,
          ])
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "CallerIsNotOwner"
      );

      expect((await marketplaceContract.getOrderStatus(orderHash))[1]).to.equal(
        false
      );
      await immutableZoneController.cancelOrders(
        immutableZone.address,
        marketplaceContract.address,
        [orderComponents]
      );
      expect((await marketplaceContract.getOrderStatus(orderHash))[1]).to.equal(
        true
      );
    });

    it("Only operator can cancel restricted orders through the zone directly", async () => {
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );

      const offer = [getTestItem721(nftId)];

      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];

      const { orderHash, orderComponents } = await createOrder(
        seller,
        immutableZone.address,
        offer,
        consideration,
        2 // FULL_RESTRICTED, zone can execute or cancel
      );

      // Non-operator address should not be allowed to operate the zone
      await expect(
        immutableZone
          .connect(owner)
          .cancelOrders(marketplaceContract.address, [orderComponents])
      ).to.be.reverted;

      // Operator is allowed to operate the zone
      faucet(immutableSigner.address, provider);
      expect((await marketplaceContract.getOrderStatus(orderHash))[1]).to.equal(
        false
      );
      await immutableZone
        .connect(immutableSigner)
        .cancelOrders(marketplaceContract.address, [orderComponents]);
      expect((await marketplaceContract.getOrderStatus(orderHash))[1]).to.equal(
        true
      );
    });

    it("Order maker can cancel their own restricted orders through Seaport", async () => {
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );

      const offer = [getTestItem721(nftId)];

      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];

      const { orderHash, orderComponents } = await createOrder(
        seller,
        stubZone,
        offer,
        consideration,
        2 // FULL_RESTRICTED
      );

      expect((await marketplaceContract.getOrderStatus(orderHash))[1]).to.equal(
        false
      );
      await marketplaceContract.connect(seller).cancel([orderComponents]);
      expect((await marketplaceContract.getOrderStatus(orderHash))[1]).to.equal(
        true
      );
    });

    it("Not zone or order maker cannot cancel restricted orders through Seaport", async () => {
      const nftId = await mintAndApprove721(
        seller,
        marketplaceContract.address
      );

      const offer = [getTestItem721(nftId)];

      const consideration = [
        getItemETH(parseEther("10"), parseEther("10"), seller.address),
        getItemETH(parseEther("1"), parseEther("1"), owner.address),
      ];

      const { orderComponents } = await createOrder(
        seller,
        stubZone,
        offer,
        consideration,
        2 // FULL_RESTRICTED
      );

      await expect(marketplaceContract.connect(buyer).cancel([orderComponents]))
        .to.be.reverted;
    });
  });

  describe("Roles", () => {
    it("Owner can transfer ownership via a two-step process", async () => {
      const immutableZoneControllerFactory = await ethers.getContractFactory(
        "ImmutableZoneController",
        owner
      );
      const immutableZoneController =
        await immutableZoneControllerFactory.deploy(owner.address);

      await createZone(immutableZoneController);

      await expect(
        immutableZoneController.connect(buyer).transferOwnership(buyer.address)
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "CallerIsNotOwner"
      );

      await expect(
        immutableZoneController.connect(owner).transferOwnership(toAddress(0))
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "OwnerCanNotBeSetAsZero"
      );

      await expect(
        immutableZoneController.connect(seller).cancelOwnershipTransfer()
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "CallerIsNotOwner"
      );

      await expect(
        immutableZoneController.connect(buyer).acceptOwnership()
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "CallerIsNotPotentialOwner"
      );

      // just get any random address as the next potential owner.
      await immutableZoneController
        .connect(owner)
        .transferOwnership(buyer.address);

      // Check potential owner
      expect(await immutableZoneController.potentialOwner()).to.equal(
        buyer.address
      );

      await immutableZoneController.connect(owner).cancelOwnershipTransfer();
      await immutableZoneController
        .connect(owner)
        .transferOwnership(buyer.address);
      await immutableZoneController.connect(buyer).acceptOwnership();

      expect(await immutableZoneController.owner()).to.equal(buyer.address);
    });

    it("Non-owner cannot assign operator", async () => {
      // Try to approve operator without permission
      await expect(
        immutableZoneController
          .connect(seller)
          .assignOperator(immutableZone.address, seller.address)
      ).to.be.revertedWithCustomError(
        immutableZoneController,
        "CallerIsNotOwner"
      );

      // Try to approve operator directly without permission
      await expect(immutableZone.connect(seller).assignOperator(seller.address))
        .to.be.reverted;
    });

    it("Owner can assign operator to change the Immutable signer address", async () => {
      await immutableZoneController
        .connect(owner)
        .assignOperator(immutableZone.address, buyer.address);
      expect(await immutableZone.operator()).to.equal(buyer.address);
    });

    it("Cannot assign operator to zero address", async () => {
      await expect(
        immutableZoneController
          .connect(owner)
          .assignOperator(immutableZone.address, toAddress(0))
      ).to.be.reverted;
    });
  });
});
