// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAlpaToken.sol";
import "../interfaces/ICryptoAlpaca.sol";
import "../interfaces/CryptoAlpacaEnergyListener.sol";

// MasterChef is the master of ALPA.
contract MasterChef is Ownable, ERC1155Receiver, CryptoAlpacaEnergyListener {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    /* ========== EVENTS ========== */

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);

    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);

    /* ========== STRUCT ========== */

    // Info of each user.
    struct UserInfo {
        // How many LP tokens the user has provided.
        uint256 amount;
        // Reward debt. What has been paid so far
        uint256 rewardDebt;
    }

    struct UserGlobalInfo {
        // alpaca user transfered to masterchef to manage the LP assets
        uint256 alpacaID;
        // alpaca's energy
        uint256 alpacaEnergy;
    }

    // Info of each pool.
    struct PoolInfo {
        // Address of LP token contract.
        IERC20 lpToken;
        // How many allocation points assigned to this pool. ALPAs to distribute per block.
        // Ex. If `totalAllocPoint` is 100 and `allocPoint` assigned to this pool is 50, and `alpaPerBlock` is 200
        //  Then this pool will recieve (50/100)*200 = 100 ALPA per block
        uint256 allocPoint;
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

    // dev address.
    address public devAddr;

    // community address.
    address public communityAddr;

    // number of ALPA tokens created per block.
    uint256 public alpaPerBlock;

    // Energy if user does not have any alpaca transfered to master chef to manage the LP assets
    uint256 public constant EMPTY_ALPACA_ENERGY = 1;

    // Info of each pool.
    PoolInfo[] public poolInfo;

    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    // Info of each user global info
    mapping(address => UserGlobalInfo) public userGlobalInfo;

    // map that keep tracks of the alpaca's original owner so contract knows where to send back when
    // users swapped or retrieved their alpacas
    EnumerableMap.UintToAddressMap private alpacaOriginalOwner;

    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;

    // The block number when ALPA mining starts.
    uint256 public startBlock;

    uint256 public constant SAFE_MULTIPLIER = 1e16;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        IAlpaToken _alpa,
        ICryptoAlpaca _cryptoAlpaca,
        address _devAddr,
        address _communityAddr,
        uint256 _alpaPerBlock,
        uint256 _startBlock
    ) public {
        alpa = _alpa;
        cryptoAlpaca = _cryptoAlpaca;
        devAddr = _devAddr;
        communityAddr = _communityAddr;
        alpaPerBlock = _alpaPerBlock;
        startBlock = _startBlock;
    }

    /* ========== PUBLIC ========== */

    /**
     * @dev Get number of LP pools
     */
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /**
     * @dev View `_user` pending ALPAs for a given `_pid` LP pool.
     */
    function pendingAlpa(uint256 _pid, address _user)
        external
        view
        returns (uint256)
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        UserGlobalInfo storage userGlobal = userGlobalInfo[msg.sender];

        uint256 accAlpaPerShare = pool.accAlpaPerShare;
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));

        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 multiplier = _getMultiplier(
                pool.lastRewardBlock,
                block.number
            );
            uint256 alpaReward = multiplier
                .mul(alpaPerBlock)
                .mul(pool.allocPoint)
                .div(totalAllocPoint);

            accAlpaPerShare = accAlpaPerShare.add(
                alpaReward.mul(SAFE_MULTIPLIER).div(pool.accShare)
            );
        }
        return
            user
                .amount
                .mul(_safeUserAlpacaEnergy(userGlobal))
                .mul(accAlpaPerShare)
                .div(SAFE_MULTIPLIER)
                .sub(user.rewardDebt);
    }

    /**
     * @dev Update reward variables for all pools. Be careful of gas spending!
     */
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    /**
     * @dev Update reward variables of the given pool to be up-to-date.
     */
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }

        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }

        uint256 multiplier = _getMultiplier(pool.lastRewardBlock, block.number);
        uint256 totalReward = multiplier
            .mul(alpaPerBlock)
            .mul(pool.allocPoint)
            .div(totalAllocPoint);

        // 10% of total reward goes to dev
        uint256 devReward = totalReward.div(10);
        alpa.mint(devAddr, devReward);

        // 10% of total reward goes to community
        uint256 communityReward = totalReward.div(10);
        alpa.mint(communityAddr, communityReward);

        // the rest goes to lp pool
        uint256 alpaReward = totalReward.sub(devReward).sub(communityReward);
        alpa.mint(address(this), alpaReward);

        pool.accAlpaPerShare = pool.accAlpaPerShare.add(
            alpaReward.mul(SAFE_MULTIPLIER).div(pool.accShare)
        );
        pool.lastRewardBlock = block.number;
    }

    /**
     * @dev Retrieve caller's Alpaca.
     */
    function retrieve() public {
        UserGlobalInfo storage userGlobal = userGlobalInfo[msg.sender];
        require(
            userGlobal.alpacaID != 0,
            "MasterChef: you do not have any alpaca"
        );

        for (uint256 pid = 0; pid < poolInfo.length; pid++) {
            UserInfo storage user = userInfo[pid][msg.sender];

            if (user.amount > 0) {
                PoolInfo storage pool = poolInfo[pid];
                updatePool(pid);
                uint256 pending = user
                    .amount
                    .mul(userGlobal.alpacaEnergy)
                    .mul(pool.accAlpaPerShare)
                    .div(SAFE_MULTIPLIER)
                    .sub(user.rewardDebt);
                if (pending > 0) {
                    _safeAlpaTransfer(msg.sender, pending);
                }

                user.rewardDebt = user
                    .amount
                    .mul(EMPTY_ALPACA_ENERGY)
                    .mul(pool.accAlpaPerShare)
                    .div(SAFE_MULTIPLIER);

                pool.accShare = pool.accShare.sub(
                    (userGlobal.alpacaEnergy.sub(1)).mul(user.amount)
                );
            }
        }
        uint256 prevAlpacaID = userGlobal.alpacaID;
        userGlobal.alpacaID = 0;
        userGlobal.alpacaEnergy = 0;

        // Remove alpaca id to original user mapping
        alpacaOriginalOwner.remove(prevAlpacaID);

        cryptoAlpaca.safeTransferFrom(
            address(this),
            msg.sender,
            prevAlpacaID,
            1,
            ""
        );
    }

    /**
     * @dev Deposit LP tokens to MasterChef for ALPA allocation.
     */
    function deposit(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        UserGlobalInfo storage userGlobal = userGlobalInfo[msg.sender];
        updatePool(_pid);

        if (user.amount > 0) {
            uint256 pending = user
                .amount
                .mul(_safeUserAlpacaEnergy(userGlobal))
                .mul(pool.accAlpaPerShare)
                .div(SAFE_MULTIPLIER)
                .sub(user.rewardDebt);
            if (pending > 0) {
                _safeAlpaTransfer(msg.sender, pending);
            }
        }

        if (_amount > 0) {
            pool.lpToken.safeTransferFrom(
                address(msg.sender),
                address(this),
                _amount
            );
            user.amount = user.amount.add(_amount);
            pool.accShare = pool.accShare.add(
                _safeUserAlpacaEnergy(userGlobal).mul(_amount)
            );
        }

        user.rewardDebt = user
            .amount
            .mul(_safeUserAlpacaEnergy(userGlobal))
            .mul(pool.accAlpaPerShare)
            .div(SAFE_MULTIPLIER);
        emit Deposit(msg.sender, _pid, _amount);
    }

    /**
     * @dev Withdraw LP tokens from MasterChef.
     */
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "MasterChef: invalid amount");

        UserGlobalInfo storage userGlobal = userGlobalInfo[msg.sender];

        updatePool(_pid);
        uint256 pending = user
            .amount
            .mul(_safeUserAlpacaEnergy(userGlobal))
            .mul(pool.accAlpaPerShare)
            .div(SAFE_MULTIPLIER)
            .sub(user.rewardDebt);
        if (pending > 0) {
            _safeAlpaTransfer(msg.sender, pending);
        }
        if (_amount > 0) {
            user.amount = user.amount.sub(_amount);
            pool.lpToken.safeTransfer(address(msg.sender), _amount);
            pool.accShare = pool.accShare.sub(
                _safeUserAlpacaEnergy(userGlobal).mul(_amount)
            );
        }

        user.rewardDebt = user
            .amount
            .mul(_safeUserAlpacaEnergy(userGlobal))
            .mul(pool.accAlpaPerShare)
            .div(SAFE_MULTIPLIER);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    /* ========== PRIVATE ========== */

    function _safeUserAlpacaEnergy(UserGlobalInfo storage userGlobal)
        private
        view
        returns (uint256)
    {
        if (userGlobal.alpacaEnergy == 0) {
            return EMPTY_ALPACA_ENERGY;
        }
        return userGlobal.alpacaEnergy;
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

    // Return reward multiplier over the given _from to _to block.
    function _getMultiplier(uint256 _from, uint256 _to)
        private
        pure
        returns (uint256)
    {
        return _to.sub(_from);
    }

    /* ========== EXTERNAL DEV MUTATION ========== */

    // Update dev address by the previous dev.
    function setDevAddr(address _devAddr) external onlyDev {
        devAddr = _devAddr;
    }

    // Update community pool addr address by the previous dev.
    function setCommunityAddr(address _communityAddr) external onlyCommunity {
        communityAddr = _communityAddr;
    }

    /* ========== EXTERNAL OWNER MUTATION ========== */

    // Update number of ALPA to mint per block
    function setAlpaPerBlock(uint256 _alpaPerBlock) external onlyOwner {
        alpaPerBlock = _alpaPerBlock;
    }

    // Transfer alpa owner to `_owner`
    // For emergency use only
    function setAlpaOwner(address _owner) external onlyOwner {
        Ownable(address(alpa)).transferOwnership(_owner);
    }

    /**
     * @dev Add a new lp to the pool. Can only be called by the owner
     */
    function add(
        uint256 _allocPoint,
        IERC20 _lpToken,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock
            ? block.number
            : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(
            PoolInfo({
                lpToken: _lpToken,
                allocPoint: _allocPoint,
                lastRewardBlock: lastRewardBlock,
                accAlpaPerShare: 0,
                accShare: 0
            })
        );
    }

    /**
     * @dev Update the given pool's ALPA allocation point. Can only be called by the owner.
     */
    function set(
        uint256 _pid,
        uint256 _allocPoint,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(
            _allocPoint
        );
        poolInfo[_pid].allocPoint = _allocPoint;
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
        bytes calldata
    ) external override returns (bytes4) {
        require(
            msg.sender == address(cryptoAlpaca),
            "MasterChef: received alpaca from unauthenticated contract"
        );

        require(_id != 0, "MasterChef: invalid alpaca");

        UserGlobalInfo storage userGlobal = userGlobalInfo[_from];

        // Fetch alpaca energy
        (, , , , , , , , , , , uint256 energy, ) = cryptoAlpaca.getAlpaca(_id);
        require(energy > 0, "MasterChef: invalid alpaca energy");

        for (uint256 i = 0; i < poolInfo.length; i++) {
            UserInfo storage user = userInfo[i][_from];

            if (user.amount > 0) {
                PoolInfo storage pool = poolInfo[i];
                updatePool(i);

                uint256 pending = user
                    .amount
                    .mul(_safeUserAlpacaEnergy(userGlobal))
                    .mul(pool.accAlpaPerShare)
                    .div(SAFE_MULTIPLIER)
                    .sub(user.rewardDebt);
                if (pending > 0) {
                    _safeAlpaTransfer(_from, pending);
                }
                // Update user reward debt with new energy
                user.rewardDebt = user
                    .amount
                    .mul(energy)
                    .mul(pool.accAlpaPerShare)
                    .div(SAFE_MULTIPLIER);

                pool.accShare = pool.accShare.add(energy.mul(user.amount)).sub(
                    _safeUserAlpacaEnergy(userGlobal).mul(user.amount)
                );
            }
        }

        // update user global
        uint256 prevAlpacaID = userGlobal.alpacaID;
        userGlobal.alpacaID = _id;
        userGlobal.alpacaEnergy = energy;

        // keep track of alpaca owner
        alpacaOriginalOwner.set(_id, _from);

        // Give original owner the right to breed
        cryptoAlpaca.grandPermissionToBreed(_from, _id);

        if (prevAlpacaID != 0) {
            // Transfer alpaca back to owner
            cryptoAlpaca.safeTransferFrom(
                address(this),
                _from,
                prevAlpacaID,
                1,
                ""
            );
        }

        return
            bytes4(
                keccak256(
                    "onERC1155Received(address,address,uint256,uint256,bytes)"
                )
            );
    }

    /**
     * @dev onERC1155BatchReceived implementation per IERC1155Receiver spec
     * User should not send using batch.
     */
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) external override returns (bytes4) {
        require(
            false,
            "MasterChef: only supports transfer single alpaca at a time (e.g safeTransferFrom)"
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
        uint256,
        uint256 _newEnergy
    ) external override {
        require(
            msg.sender == address(cryptoAlpaca),
            "MasterChef: received alpaca from unauthenticated contract"
        );

        require(
            alpacaOriginalOwner.contains(_id),
            "MasterChef: original owner not found"
        );

        address originalOwner = alpacaOriginalOwner.get(_id);
        UserGlobalInfo storage userGlobal = userGlobalInfo[originalOwner];

        for (uint256 i = 0; i < poolInfo.length; i++) {
            UserInfo storage user = userInfo[i][originalOwner];

            if (user.amount > 0) {
                PoolInfo storage pool = poolInfo[i];
                updatePool(i);

                uint256 pending = user
                    .amount
                    .mul(_safeUserAlpacaEnergy(userGlobal))
                    .mul(pool.accAlpaPerShare)
                    .div(SAFE_MULTIPLIER)
                    .sub(user.rewardDebt);

                if (pending > 0) {
                    _safeAlpaTransfer(originalOwner, pending);
                }

                // Update user reward debt with new energy
                user.rewardDebt = user
                    .amount
                    .mul(_newEnergy)
                    .mul(pool.accAlpaPerShare)
                    .div(SAFE_MULTIPLIER);

                pool.accShare = pool
                    .accShare
                    .add(_newEnergy.mul(user.amount))
                    .sub(_safeUserAlpacaEnergy(userGlobal).mul(user.amount));
            }
        }

        // update alpaca energy
        userGlobal.alpacaEnergy = _newEnergy;
    }

    /* ========== MODIFIER ========== */

    modifier onlyDev() {
        require(devAddr == _msgSender(), "Masterchef: caller is not the dev");
        _;
    }

    modifier onlyCommunity() {
        require(
            communityAddr == _msgSender(),
            "Masterchef: caller is not the community"
        );
        _;
    }
}
