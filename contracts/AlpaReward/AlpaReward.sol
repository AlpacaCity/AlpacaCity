// SPDX-License-Identifier: MIT

pragma solidity =0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

// AlpaReward
contract AlpaReward is ERC20("AlpaReward", "xALPA") {
    using SafeMath for uint256;

    /* ========== STATE VARIABLES ========== */

    IERC20 public alpa;

    /* ========== CONSTRUCTOR ========== */

    /**
     * Define the ALPA token contract
     */

    constructor(IERC20 _alpa) public {
        alpa = _alpa;
    }

    /* ========== EXTERNAL MUTATIVE FUNCTIONS ========== */

    /**
     * Locks ALPA and mints xALPA
     * @param _amount of ALPA to stake
     */
    function enter(uint256 _amount) external {
        // Gets the amount of ALPA locked in the contract
        uint256 totalAlpa = alpa.balanceOf(address(this));

        // Gets the amount of xALPA in existence
        uint256 totalShares = totalSupply();

        // If no xALPA exists, mint it 1:1 to the amount put in
        if (totalShares == 0 || totalAlpa == 0) {
            _mint(msg.sender, _amount);
        } else {
            // Calculate and mint the amount of xALPA the ALPA is worth. The ratio will change overtime, as xALPA is burned/minted and ALPA deposited + gained from fees / withdrawn.
            uint256 what = _amount.mul(totalShares).div(totalAlpa);
            _mint(msg.sender, what);
        }

        // Lock the ALPA in the contract
        alpa.transferFrom(msg.sender, address(this), _amount);
    }

    /**
     * Claim back your ALPAs.
     * Unclocks the staked + gained ALPA and burns xALPA
     * @param _share amount of xALPA
     */
    function leave(uint256 _share) external {
        // Gets the amount of xALPA in existence
        uint256 totalShares = totalSupply();

        // Calculates the amount of ALPA the xALPA is worth
        uint256 what = _share.mul(alpa.balanceOf(address(this))).div(
            totalShares
        );
        _burn(msg.sender, _share);

        alpa.transfer(msg.sender, what);
    }
}
