// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IAlpaToken.sol";
import "../interfaces/IAlpaSupplier.sol";
import "../interfaces/ICryptoAlpaca.sol";
import "../interfaces/CryptoAlpacaEnergyListener.sol";

// Alpaca Squad manages your you alpacas
contract AlpacaSquad is
    Ownable,
    ReentrancyGuard,
    ERC1155Receiver,
    CryptoAlpacaEnergyListener
{
    using SafeMath for uint256;
    using Math for uint256;
    using SafeERC20 for IERC20;
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    // Info of each user.
    struct UserInfo {
        // Reward debt
        uint256 rewardDebt;
        // share
        uint256 share;
        // number of alpacas in this squad
        uint256 numAlpacas;
        // sum of alpaca energy
        uint256 sumEnergy;
    }

    // Info of Reward.
    struct RewardInfo {
        // Last block number that ALPAs distribution occurs.
        uint256 lastRewardBlock;
        // Accumulated ALPAs per share. Share is determined by LP deposit and total alpaca's energy
        uint256 accAlpaPerShare;
        // Accumulated Share
        uint256 accShare;
    }

    /* ========== STATES ========== */

    // The ALPA ERC20 token
    IAlpaToken public alpa;

    // Crypto alpaca contract
    ICryptoAlpaca public cryptoAlpaca;

    // Alpa Supplier
    IAlpaSupplier public supplier;

    // farm pool info
    RewardInfo public rewardInfo;

    uint256 public maxAlpacaSquadCount = 20;

    // Info of each user.
    mapping(address => UserInfo) public userInfo;

    // map that keep tracks of the alpaca's original owner so contract knows where to send back when
    // users retrieves their alpacas
    EnumerableMap.UintToAddressMap private alpacaOriginalOwner;

    uint256 public constant SAFE_MULTIPLIER = 1e16;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        IAlpaToken _alpa,
        ICryptoAlpaca _cryptoAlpaca,
        IAlpaSupplier _supplier,
        uint256 _startBlock
    ) public {
        alpa = _alpa;
        cryptoAlpaca = _cryptoAlpaca;
        supplier = _supplier;
        rewardInfo = RewardInfo({
            lastRewardBlock: block.number.max(_startBlock),
            accAlpaPerShare: 0,
            accShare: 0
        });
    }

    /* ========== PUBLIC ========== */

    /**
     * @dev View `_user` pending ALPAs
     */
    function pendingAlpa(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];

        uint256 accAlpaPerShare = rewardInfo.accAlpaPerShare;

        if (
            block.number > rewardInfo.lastRewardBlock &&
            rewardInfo.accShare != 0
        ) {
            uint256 total = supplier.preview(
                address(this),
                rewardInfo.lastRewardBlock
            );

            accAlpaPerShare = accAlpaPerShare.add(
                total.mul(SAFE_MULTIPLIER).div(rewardInfo.accShare)
            );
        }

        return
            user.share.mul(accAlpaPerShare).div(SAFE_MULTIPLIER).sub(
                user.rewardDebt
            );
    }

    /**
     * @dev Update reward variables of the given pool to be up-to-date.
     */
    function updatePool() public {
        if (block.number <= rewardInfo.lastRewardBlock) {
            return;
        }

        if (rewardInfo.accShare == 0) {
            rewardInfo.lastRewardBlock = block.number;
            return;
        }

        uint256 reward = supplier.distribute(rewardInfo.lastRewardBlock);
        rewardInfo.accAlpaPerShare = rewardInfo.accAlpaPerShare.add(
            reward.mul(SAFE_MULTIPLIER).div(rewardInfo.accShare)
        );

        rewardInfo.lastRewardBlock = block.number;
    }

    /**
     * @dev Retrieve caller's alpacas
     */
    function retrieve(uint256[] memory _ids) public nonReentrant {
        require(_ids.length > 0, "AlpacaSquad: invalid argument");

        address sender = msg.sender;
        UserInfo storage user = userInfo[sender];
        (
            uint256 share,
            uint256 numAlpacas,
            uint256 sumEnergy
        ) = _calculateDeletion(sender, user, _ids);

        updatePool();

        uint256 pending = user
            .share
            .mul(rewardInfo.accAlpaPerShare)
            .div(SAFE_MULTIPLIER)
            .sub(user.rewardDebt);
        if (pending > 0) {
            _safeAlpaTransfer(sender, pending);
        }

        // Update user reward debt with new share
        user.rewardDebt = share.mul(rewardInfo.accAlpaPerShare).div(
            SAFE_MULTIPLIER
        );

        // Update reward info accumulated share
        rewardInfo.accShare = rewardInfo.accShare.add(share).sub(user.share);

        user.share = share;
        user.numAlpacas = numAlpacas;
        user.sumEnergy = sumEnergy;

        for (uint256 i = 0; i < _ids.length; i++) {
            alpacaOriginalOwner.remove(_ids[i]);
            cryptoAlpaca.safeTransferFrom(
                address(this),
                sender,
                _ids[i],
                1,
                ""
            );
        }
    }

    /**
     * @dev Claim user reward
     */
    function claim() public nonReentrant {
        updatePool();
        address sender = msg.sender;

        UserInfo storage user = userInfo[sender];
        if (user.sumEnergy > 0) {
            uint256 pending = user
                .share
                .mul(rewardInfo.accAlpaPerShare)
                .div(SAFE_MULTIPLIER)
                .sub(user.rewardDebt);

            if (pending > 0) {
                _safeAlpaTransfer(sender, pending);
            }

            user.rewardDebt = user.share.mul(rewardInfo.accAlpaPerShare).div(
                SAFE_MULTIPLIER
            );
        }
    }

    /* ========== ERC1155Receiver ========== */

    /**
     * @dev onERC1155Received implementation per IERC1155Receiver spec
     */
    function onERC1155Received(
        address,
        address _from,
        uint256 _id,
        uint256,
        bytes memory
    ) external override nonReentrant fromCryptoAlpaca returns (bytes4) {
        UserInfo storage user = userInfo[_from];
        uint256[] memory ids = _asSingletonArray(_id);
        (
            uint256 share,
            uint256 numAlpacas,
            uint256 sumEnergy
        ) = _calculateAddition(user, ids);

        updatePool();

        if (user.sumEnergy > 0) {
            uint256 pending = user
                .share
                .mul(rewardInfo.accAlpaPerShare)
                .div(SAFE_MULTIPLIER)
                .sub(user.rewardDebt);
            if (pending > 0) {
                _safeAlpaTransfer(_from, pending);
            }
        }

        // Update user reward debt with new share
        user.rewardDebt = share.mul(rewardInfo.accAlpaPerShare).div(
            SAFE_MULTIPLIER
        );

        // Update reward info accumulated share
        rewardInfo.accShare = rewardInfo.accShare.add(share).sub(user.share);

        user.share = share;
        user.numAlpacas = numAlpacas;
        user.sumEnergy = sumEnergy;

        // Give original owner the right to breed
        cryptoAlpaca.grandPermissionToBreed(_from, _id);

        // store original owner
        alpacaOriginalOwner.set(_id, _from);

        return
            bytes4(
                keccak256(
                    "onERC1155Received(address,address,uint256,uint256,bytes)"
                )
            );
    }

    /**
     * @dev onERC1155BatchReceived implementation per IERC1155Receiver spec
     */
    function onERC1155BatchReceived(
        address,
        address _from,
        uint256[] memory _ids,
        uint256[] memory,
        bytes memory
    ) external override nonReentrant fromCryptoAlpaca returns (bytes4) {
        UserInfo storage user = userInfo[_from];
        (
            uint256 share,
            uint256 numAlpacas,
            uint256 sumEnergy
        ) = _calculateAddition(user, _ids);

        updatePool();

        if (user.sumEnergy > 0) {
            uint256 pending = user
                .share
                .mul(rewardInfo.accAlpaPerShare)
                .div(SAFE_MULTIPLIER)
                .sub(user.rewardDebt);
            if (pending > 0) {
                _safeAlpaTransfer(_from, pending);
            }
        }

        // Update user reward debt with new share
        user.rewardDebt = share.mul(rewardInfo.accAlpaPerShare).div(
            SAFE_MULTIPLIER
        );

        // Update reward info accumulated share
        rewardInfo.accShare = rewardInfo.accShare.add(share).sub(user.share);

        user.share = share;
        user.numAlpacas = numAlpacas;
        user.sumEnergy = sumEnergy;

        // Give original owner the right to breed
        for (uint256 i = 0; i < _ids.length; i++) {
            // store original owner
            alpacaOriginalOwner.set(_ids[i], _from);

            // Give original owner the right to breed
            cryptoAlpaca.grandPermissionToBreed(_from, _ids[i]);
        }

        return
            bytes4(
                keccak256(
                    "onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"
                )
            );
    }

    /* ========== ICryptoAlpacaEnergyListener ========== */

    /**
        @dev Handles the Alpaca energy change callback.
        @param _id The id of the Alpaca which the energy changed
        @param _newEnergy The new alpaca energy it changed to
    */
    function onCryptoAlpacaEnergyChanged(
        uint256 _id,
        uint256 _oldEnergy,
        uint256 _newEnergy
    ) external override fromCryptoAlpaca ownsAlpaca(_id) {
        address from = alpacaOriginalOwner.get(_id);
        UserInfo storage user = userInfo[from];

        uint256 sumEnergy = user.sumEnergy.add(_newEnergy).sub(_oldEnergy);
        uint256 share = sumEnergy.mul(sumEnergy).div(user.numAlpacas);

        updatePool();

        if (user.sumEnergy > 0) {
            uint256 pending = user
                .share
                .mul(rewardInfo.accAlpaPerShare)
                .div(SAFE_MULTIPLIER)
                .sub(user.rewardDebt);
            if (pending > 0) {
                _safeAlpaTransfer(from, pending);
            }
        }
        // Update user reward debt with new share
        user.rewardDebt = share.mul(rewardInfo.accAlpaPerShare).div(
            SAFE_MULTIPLIER
        );

        // Update reward info accumulated share
        rewardInfo.accShare = rewardInfo.accShare.add(share).sub(user.share);

        user.share = share;
        user.sumEnergy = sumEnergy;
    }

    /* ========== PRIVATE ========== */

    /**
     * @dev given user and array of alpacas ids, it validate the alpacas
     * and calculates the user share, numAlpacas, and sumEnergy after the addition
     */
    function _calculateAddition(UserInfo storage _user, uint256[] memory _ids)
        private
        view
        returns (
            uint256 share,
            uint256 numAlpacas,
            uint256 sumEnergy
        )
    {
        require(
            _user.numAlpacas + _ids.length <= maxAlpacaSquadCount,
            "AlpacaSquad: Max alpaca reached"
        );
        numAlpacas = _user.numAlpacas + _ids.length;
        sumEnergy = _user.sumEnergy;

        for (uint256 i = 0; i < _ids.length; i++) {
            uint256 id = _ids[i];
            require(id != 0, "AlpacaSquad: invalid alpaca");

            // Fetch alpaca energy and state
            (, , , , , , , , , , , uint256 energy, uint256 state) = cryptoAlpaca
                .getAlpaca(id);
            require(state == 1, "AlpacaFarm: invalid alpaca state");
            require(energy > 0, "AlpacaFarm: invalid alpaca energy");
            sumEnergy = sumEnergy.add(energy);
        }

        share = sumEnergy.mul(sumEnergy).div(numAlpacas);
    }

    function _calculateDeletion(
        address owner,
        UserInfo storage _user,
        uint256[] memory _ids
    )
        private
        view
        returns (
            uint256 share,
            uint256 numAlpacas,
            uint256 sumEnergy
        )
    {
        numAlpacas = _user.numAlpacas.sub(_ids.length);
        sumEnergy = _user.sumEnergy;

        for (uint256 i = 0; i < _ids.length; i++) {
            uint256 id = _ids[i];
            require(
                alpacaOriginalOwner.get(id) == owner,
                "AlpacaFarm: original owner not found"
            );

            // Fetch alpaca energy and state
            (, , , , , , , , , , , uint256 energy, ) = cryptoAlpaca.getAlpaca(
                id
            );
            sumEnergy = sumEnergy.sub(energy);
        }

        if (numAlpacas > 0) {
            share = sumEnergy.mul(sumEnergy).div(numAlpacas);
        }
    }

    function _asSingletonArray(uint256 element)
        private
        pure
        returns (uint256[] memory)
    {
        uint256[] memory array = new uint256[](1);
        array[0] = element;

        return array;
    }

    // Safe alpa transfer function, just in case if rounding error causes pool to not have enough ALPAs.
    function _safeAlpaTransfer(address _to, uint256 _amount) private {
        uint256 alpaBal = alpa.balanceOf(address(this));
        if (_amount > alpaBal) {
            alpa.transfer(_to, alpaBal);
        } else {
            alpa.transfer(_to, _amount);
        }
    }

    /* ========== Owner ========== */

    function setMaxAlpacaSquadCount(uint256 _count) public onlyOwner {
        maxAlpacaSquadCount = _count;
    }

    /* ========== MODIFIER ========== */

    modifier fromCryptoAlpaca() {
        require(
            msg.sender == address(cryptoAlpaca),
            "AlpacaFarm: received alpaca from unauthenticated contract"
        );
        _;
    }

    modifier ownsAlpaca(uint256 _id) {
        require(
            alpacaOriginalOwner.contains(_id),
            "AlpacaFarm: original owner not found"
        );
        _;
    }
}
