// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {
    ZoneParameters,
    Schema,
    ReceivedItem
} from "../lib/ConsiderationStructs.sol";

import { ZoneInterface } from "../interfaces/ZoneInterface.sol";

import {
    ImmutableSignedZoneInterface
} from "./interfaces/ImmutableSignedZoneInterface.sol";

import {
    SignedZoneEventsAndErrors
} from "./interfaces/SignedZoneEventsAndErrors.sol";

import { SIP5Interface } from "./interfaces/SIP5Interface.sol";

import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

import "hardhat/console.sol";

/**
 * @title  ImmutableSignedZone
 * @author ryanio, Immutable
 * @notice ImmutableSignedZone is a zone implementation based on the
 *         SIP-7 standard https://github.com/ProjectOpenSea/SIPs/blob/main/SIPS/sip-7.md
 *         Implementing substandard 3. We also implement SIP-6 for a slightly different
 *         extraData configuration (1 leading byte used by SIP-6)
 *
 *         Inspiration and reference from the following contracts:
 *         https://github.com/ProjectOpenSea/seaport/blob/024dcc5cd70231ce6db27b4e12ea6fb736f69b06/contracts/zones/SignedZone.sol
 *         https://github.com/reservoirprotocol/seaport-oracle/blob/master/packages/contracts/src/zones/SignedZone.sol
 */
contract ImmutableSignedZone is
    SignedZoneEventsAndErrors,
    ZoneInterface,
    SIP5Interface,
    ImmutableSignedZoneInterface,
    Ownable2Step
{
    /// @dev The allowed signers.
    mapping(address => SignerInfo) private _signers;

    /// @dev The API endpoint where orders for this zone can be signed.
    ///      Request and response payloads are defined in SIP-7.
    string private _sip7APIEndpoint;

    /// @dev The name for this zone returned in getSeaportMetadata().
    string private _ZONE_NAME;

    /// @dev The EIP-712 digest parameters.
    bytes32 internal immutable _NAME_HASH =
        keccak256(bytes("ImmutableSignedZone"));
    bytes32 internal immutable _VERSION_HASH = keccak256(bytes("1.0"));
    bytes32 internal immutable _EIP_712_DOMAIN_TYPEHASH =
        keccak256(
            abi.encodePacked(
                "EIP712Domain(",
                "string name,",
                "string version,",
                "uint256 chainId,",
                "address verifyingContract",
                ")"
            )
        );

    uint256 internal immutable _CHAIN_ID = block.chainid;
    bytes32 internal immutable _DOMAIN_SEPARATOR;

    /**
     * @notice Constructor to deploy the contract.
     *
     * @param zoneName    The name for the zone returned in
     *                    getSeaportMetadata().
     * @param apiEndpoint The API endpoint where orders for this zone can be
     *                    signed.
     *                    Request and response payloads are defined in SIP-7.
     */
    constructor(string memory zoneName, string memory apiEndpoint) {
        // Set the zone name.
        _ZONE_NAME = zoneName;

        // Set the API endpoint.
        _sip7APIEndpoint = apiEndpoint;

        // Derive and set the domain separator.
        _DOMAIN_SEPARATOR = _deriveDomainSeparator();

        // Emit an event to signal a SIP-5 contract has been deployed.
        emit SeaportCompatibleContractDeployed();
    }

    /**
     * @notice Add a new signer to the zone.
     *
     * @param signer The new signer address to add.
     */
    function addSigner(address signer) external override onlyOwner {
        // Do not allow the zero address to be added as a signer.
        if (signer == address(0)) {
            revert SignerCannotBeZeroAddress();
        }

        // Revert if the signer is already added.
        if (_signers[signer].active) {
            revert SignerAlreadyAdded(signer);
        }

        // Revert if the signer was previously authorized.
        if (_signers[signer].previouslyActive) {
            revert SignerCannotBeReauthorized(signer);
        }

        // Set the signer info.
        _signers[signer] = SignerInfo(true, true);

        // Emit an event that the signer was added.
        emit SignerAdded(signer);
    }

    /**
     * @notice Remove an active signer from the zone.
     *
     * @param signer The signer address to remove.
     */
    function removeSigner(address signer) external override onlyOwner {
        // Revert if the signer is not active.
        if (!_signers[signer].active) {
            revert SignerNotPresent(signer);
        }

        // Set the signer's active status to false.
        _signers[signer].active = false;

        // Emit an event that the signer was removed.
        emit SignerRemoved(signer);
    }

    /**
     * @notice Check if a given order including extraData is currently valid.
     *
     * @dev This function is called by Seaport whenever any extraData is
     *      provided by the caller.
     *
     * @return validOrderMagicValue A magic value indicating if the order is
     *                              currently valid.
     */
    function validateOrder(
        ZoneParameters calldata zoneParameters
    ) external view override returns (bytes4 validOrderMagicValue) {
        // Put the extraData and orderHash on the stack for cheaper access.
        bytes calldata extraData = zoneParameters.extraData;
        bytes32 orderHash = zoneParameters.orderHash;

        // Revert with an error if the extraData is empty.
        if (extraData.length == 0) {
            revert InvalidExtraData("extraData is empty", orderHash);
        }

        // Revert with an error if the extraData does not have valid length.
        if (extraData.length < 93) {
            revert InvalidExtraData(
                "extraData length must be at least 93 bytes",
                orderHash
            );
        }

        // Note that we assume the extraData here also adheres to
        // SIP-6 https://github.com/ProjectOpenSea/SIPs/blob/main/SIPS/sip-6.md
        // This adds an additional byte (extraData[0])
        // Which means the following byte references are 1 off from the SIP-7 spec
        bytes calldata sip6Version = extraData[0:1];

        // extraData bytes 1-21: expected fulfiller
        // (zero address means not restricted)
        address expectedFulfiller = address(bytes20(extraData[1:21]));

        // extraData bytes 21-29: expiration timestamp (uint64)
        uint64 expiration = uint64(bytes8(extraData[21:29]));

        // extraData bytes 29-93: signature
        // (strictly requires 64 byte compact sig, EIP-2098)
        bytes calldata signature = extraData[29:93];

        // extraData bytes 93-end: context (optional, variable length)
        bytes calldata context = extraData[93:];

        // Revert if expired.
        if (block.timestamp > expiration) {
            revert SignatureExpired(expiration, orderHash);
        }

        // Put fulfiller on the stack for more efficient access.
        address actualFulfiller = zoneParameters.fulfiller;

        validOrderMagicValue = ZoneInterface.validateOrder.selector;
    }

    /**
     * @dev Internal view function to get the EIP-712 domain separator. If the
     *      chainId matches the chainId set on deployment, the cached domain
     *      separator will be returned; otherwise, it will be derived from
     *      scratch.
     *
     * @return The domain separator.
     */
    function _domainSeparator() internal view returns (bytes32) {
        return
            block.chainid == _CHAIN_ID
                ? _DOMAIN_SEPARATOR
                : _deriveDomainSeparator();
    }

    /**
     * @dev Returns Seaport metadata for this contract, returning the
     *      contract name and supported schemas.
     *
     * @return name    The contract name
     * @return schemas The supported SIPs
     */
    function getSeaportMetadata()
        external
        view
        override(SIP5Interface, ZoneInterface)
        returns (string memory name, Schema[] memory schemas)
    {
        name = _ZONE_NAME;
        schemas = new Schema[](1);
        schemas[0].id = 7;
    }

    /**
     * @dev Internal view function to derive the EIP-712 domain separator.
     *
     * @return domainSeparator The derived domain separator.
     */
    function _deriveDomainSeparator()
        internal
        view
        returns (bytes32 domainSeparator)
    {
        return
            keccak256(
                abi.encode(
                    _EIP_712_DOMAIN_TYPEHASH,
                    _NAME_HASH,
                    _VERSION_HASH,
                    block.chainid,
                    address(this)
                )
            );
    }

    /**
     * @notice Update the API endpoint returned by this zone.
     *
     * @param newApiEndpoint The new API endpoint.
     */
    function updateAPIEndpoint(
        string calldata newApiEndpoint
    ) external override onlyOwner {
        // Update to the new API endpoint.
        _sip7APIEndpoint = newApiEndpoint;
    }

    /**
     * @notice Returns signing information about the zone.
     *
     * @return domainSeparator The domain separator used for signing.
     */
    function sip7Information()
        external
        view
        override
        returns (bytes32 domainSeparator, string memory apiEndpoint)
    {
        // Derive the domain separator.
        domainSeparator = _domainSeparator();

        // Return the API endpoint.
        apiEndpoint = _sip7APIEndpoint;
    }
}
