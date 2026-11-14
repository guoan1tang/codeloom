package com.acme.roster;

import com.acme.roster.entity.ShopGroup;
import com.acme.roster.entity.ShopInfo;
import com.acme.roster.entity.UserPermission;
import com.acme.roster.registry.ShopInfoRegistry;
import com.acme.roster.registry.UserPermissionRegistry;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class UserPermissionManager {
    @Autowired
    private UserPermissionRegistry userPermissionRegistry;
    @Autowired
    private ShopInfoRegistry shopInfoRegistry;
    @Autowired
    private UserShopCorrelationManager userShopCorrelationManager;
    @Autowired
    private ShopGroupManager shopGroupManager;

    /** Reads user_permission, then shop_info — both via the generic utility. */
    public List<Long> listShopIdByUserId(Long userId) {
        List<UserPermission> permissions = PaginationUtils.queryAllWithPagination(userPermissionRegistry,
                Wrappers.<UserPermission>lambdaQuery().eq(UserPermission::getUserId, userId));
        List<Long> ids = permissions.stream().map(UserPermission::getCorrelationId).collect(Collectors.toList());

        List<Long> shopIds = new ArrayList<>(userShopCorrelationManager.expandDeptToShopIds(ids));
        shopIds.addAll(shopGroupManager.listByIds(ids).stream().map(ShopGroup::getShopId).collect(Collectors.toList()));

        return PaginationUtils.queryAllWithPagination(shopInfoRegistry,
                Wrappers.<ShopInfo>lambdaQuery().in(ShopInfo::getId, shopIds))
                .stream().map(ShopInfo::getId).distinct().collect(Collectors.toList());
    }
}