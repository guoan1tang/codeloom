package com.acme.roster;

import com.acme.roster.entity.ShopGroup;
import com.acme.roster.registry.ShopGroupRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ShopGroupManager {
    @Autowired
    private ShopGroupRegistry shopGroupRegistry;

    /** Direct fluent chain on a bare-name entity (no @TableName, no suffix). */
    public List<ShopGroup> listByIds(List<Long> ids) {
        return shopGroupRegistry.lambdaQuery()
                .in(ShopGroup::getId, ids)
                .eq(ShopGroup::getDeleted, false)
                .list();
    }
}