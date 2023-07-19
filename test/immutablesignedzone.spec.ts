/* eslint-disable camelcase */
import { expect } from "chai";
import { Wallet, constants } from "ethers";
import { keccak256 } from "ethers/lib/utils";
import { ethers } from "hardhat";

import { ImmutableSignedZone__factory } from "../typechain-types";

import {
  CONSIDERATION_EIP712_TYPE,
  EIP712_DOMAIN,
  SIGNED_ORDER_EIP712_TYPE,
  advanceBlockBySeconds,
  autoMining,
  convertSignatureToEIP2098,
  getCurrentTimeStamp,
} from "./signedZone/utils";

import type { ImmutableSignedZone } from "../typechain-types";
import type { ReceivedItemStruct } from "../typechain-types/contracts/interfaces/ConsiderationEventsAndErrors";
import type { ZoneParametersStruct } from "../typechain-types/contracts/interfaces/ZoneInterface";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BytesLike } from "ethers";

describe.only("ImmutableSignedZone", function () {
  let deployer: SignerWithAddress;
  let users: SignerWithAddress[];
  let contract: ImmutableSignedZone;

  beforeEach(async () => {
    // automine ensure time based tests will work
    await autoMining();
    users = await ethers.getSigners();
    deployer = users[0];
    const factory = await ethers.getContractFactory("ImmutableSignedZone");
    const tx = await factory
      .connect(deployer)
      .deploy("ImmutableSignedZone", "");

    const address = (await tx.deployed()).address;

    contract = ImmutableSignedZone__factory.connect(address, deployer);
  });

  describe("Order Validation", async function () {
    let signer: Wallet;

    beforeEach(async () => {
      signer = ethers.Wallet.createRandom();
      // wait 1 block for all TXs
      await (await contract.addSigner(signer.address)).wait(1);
    });

    it("validateOrder reverts without extraData", async function () {
      await expect(
        contract.validateOrder(mockZoneParameter([]))
      ).to.be.revertedWithCustomError(contract, "InvalidExtraData");
    });

    it("validateOrder reverts with invalid extraData", async function () {
      await expect(
        contract.validateOrder(mockZoneParameter([1, 2, 3]))
      ).to.be.revertedWithCustomError(contract, "InvalidExtraData");
    });

    it("validateOrder reverts with expired timestamp", async function () {
      const orderHash = keccak256("0x1234");
      const expiration = await getCurrentTimeStamp();
      const fulfiller = constants.AddressZero;
      const context = ethers.utils.randomBytes(33);
      context[0] = 0;
      const signedOrder = {
        fulfiller,
        expiration,
        orderHash,
        context,
      };

      const signature = await signer._signTypedData(
        EIP712_DOMAIN(1, contract.address),
        SIGNED_ORDER_EIP712_TYPE,
        signedOrder
      );

      const extraData = ethers.utils.solidityPack(
        ["bytes1", "address", "uint64", "bytes", "bytes"],
        [
          0,
          fulfiller,
          expiration,
          convertSignatureToEIP2098(signature),
          context,
        ]
      );

      await advanceBlockBySeconds(100);
      await expect(
        contract.validateOrder(mockZoneParameter(extraData))
      ).to.be.revertedWithCustomError(contract, "SignatureExpired");
    });
  });
});

function mockConsideration(howMany: number = 10): ReceivedItemStruct[] {
  const consideration = [];
  for (let i = 0; i < howMany; i++) {
    consideration.push({
      itemType: 0,
      token: Wallet.createRandom().address,
      identifier: 123,
      amount: 12,
      recipient: Wallet.createRandom().address,
    });
  }

  return consideration;
}

function mockZoneParameter(
  extraData: BytesLike,
  consideration: ReceivedItemStruct[] = []
): ZoneParametersStruct {
  return {
    orderHash: keccak256("0x1234"),
    fulfiller: constants.AddressZero,
    offerer: constants.AddressZero,
    offer: [],
    consideration,
    extraData,
    orderHashes: [],
    startTime: 0,
    endTime: 0,
    zoneHash: constants.HashZero,
  };
}
