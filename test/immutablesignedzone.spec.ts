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
  let chainId: number;

  beforeEach(async () => {
    // automine ensure time based tests will work
    await autoMining();
    chainId = (await ethers.provider.getNetwork()).chainId;
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
      const signedOrder = {
        fulfiller,
        expiration,
        orderHash,
        context,
      };

      const signature = await signer._signTypedData(
        EIP712_DOMAIN(chainId, contract.address),
        SIGNED_ORDER_EIP712_TYPE,
        signedOrder
      );

      const extraData = ethers.utils.solidityPack(
        ["bytes1", "address", "uint64", "bytes", "bytes"],
        [
          0, // SIP6 version
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

    it("validateOrder reverts with invalid fulfiller", async function () {
      const orderHash = keccak256("0x1234");
      const expiration = (await getCurrentTimeStamp()) + 100;
      const fulfiller = Wallet.createRandom().address;
      const context = ethers.utils.randomBytes(33);
      const signedOrder = {
        fulfiller,
        expiration,
        orderHash,
        context,
      };

      const signature = await signer._signTypedData(
        EIP712_DOMAIN(chainId, contract.address),
        SIGNED_ORDER_EIP712_TYPE,
        signedOrder
      );

      const extraData = ethers.utils.solidityPack(
        ["bytes1", "address", "uint64", "bytes", "bytes"],
        [
          0, // SIP6 version
          fulfiller,
          expiration,
          convertSignatureToEIP2098(signature),
          context,
        ]
      );

      await expect(
        contract.validateOrder(mockZoneParameter(extraData))
      ).to.be.revertedWithCustomError(contract, "InvalidFulfiller");
    });

    it("validateOrder reverts with non 0 SIP6 version", async function () {
      const orderHash = keccak256("0x1234");
      const expiration = (await getCurrentTimeStamp()) + 100;
      const fulfiller = constants.AddressZero;
      const context = ethers.utils.randomBytes(33);
      const signedOrder = {
        fulfiller,
        expiration,
        orderHash,
        context,
      };

      const signature = await signer._signTypedData(
        EIP712_DOMAIN(chainId, contract.address),
        SIGNED_ORDER_EIP712_TYPE,
        signedOrder
      );

      const extraData = ethers.utils.solidityPack(
        ["bytes1", "address", "uint64", "bytes", "bytes"],
        [
          1, // SIP6 version
          fulfiller,
          expiration,
          convertSignatureToEIP2098(signature),
          context,
        ]
      );

      await expect(
        contract.validateOrder(mockZoneParameter(extraData))
      ).to.be.revertedWithCustomError(contract, "InvalidSIP6Version");
    });

    it("validateOrder reverts with no context", async function () {
      const orderHash = keccak256("0x1234");
      const expiration = (await getCurrentTimeStamp()) + 100;
      const fulfiller = constants.AddressZero;
      const context: BytesLike = [];
      const signedOrder = {
        fulfiller,
        expiration,
        orderHash,
        context,
      };

      const signature = await signer._signTypedData(
        EIP712_DOMAIN(chainId, contract.address),
        SIGNED_ORDER_EIP712_TYPE,
        signedOrder
      );

      const extraData = ethers.utils.solidityPack(
        ["bytes1", "address", "uint64", "bytes", "bytes"],
        [
          0, // SIP6 version
          fulfiller,
          expiration,
          convertSignatureToEIP2098(signature),
          context,
        ]
      );

      await expect(
        contract.validateOrder(mockZoneParameter(extraData))
      ).to.be.revertedWithCustomError(contract, "InvalidConsideration");
    });

    it("validateOrder reverts with wrong consideration", async function () {
      const orderHash = keccak256("0x1234");
      const expiration = (await getCurrentTimeStamp()) + 100;
      const fulfiller = constants.AddressZero;
      const consideration = mockConsideration();
      const context: BytesLike = ethers.utils.solidityPack(
        ["bytes1", "bytes"],
        [0, constants.HashZero]
      );
      const signedOrder = {
        fulfiller,
        expiration,
        orderHash,
        context,
      };

      const signature = await signer._signTypedData(
        EIP712_DOMAIN(chainId, contract.address),
        SIGNED_ORDER_EIP712_TYPE,
        signedOrder
      );

      const extraData = ethers.utils.solidityPack(
        ["bytes1", "address", "uint64", "bytes", "bytes"],
        [
          0, // SIP6 version
          fulfiller,
          expiration,
          convertSignatureToEIP2098(signature),
          context,
        ]
      );

      await expect(
        contract.validateOrder(mockZoneParameter(extraData, consideration))
      ).to.be.revertedWithCustomError(contract, "InvalidConsideration");
    });

    it("validates correct signature with context", async function () {
      const orderHash = keccak256("0x1234");
      const expiration = (await getCurrentTimeStamp()) + 100;
      const fulfiller = constants.AddressZero;
      const consideration = mockConsideration();
      const considerationHash = ethers.utils._TypedDataEncoder.hashStruct(
        "Consideration",
        CONSIDERATION_EIP712_TYPE,
        {
          consideration,
        }
      );

      const context: BytesLike = ethers.utils.solidityPack(
        ["bytes"],
        [considerationHash]
      );

      const signedOrder = {
        fulfiller,
        expiration,
        orderHash,
        context,
      };

      const signature = await signer._signTypedData(
        EIP712_DOMAIN(chainId, contract.address),
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

      expect(
        await contract.validateOrder(
          mockZoneParameter(extraData, consideration)
        )
      ).to.be.equal("0x17b1f942"); // ZoneInterface.validateOrder.selector
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
    // fix order hash for testing (zone doesn't validate its actual validity)
    orderHash: keccak256("0x1234"),
    fulfiller: constants.AddressZero,
    // zero address - also does not get validated in zone
    offerer: constants.AddressZero,
    // empty offer - no validation in zone
    offer: [],
    consideration,
    extraData,
    orderHashes: [],
    startTime: 0,
    endTime: 0,
    // we do not use zone hash
    zoneHash: constants.HashZero,
  };
}
