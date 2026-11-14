package com.acme.roster;

import com.acme.roster.entity.UserSignApplication;
import com.acme.roster.registry.UserSignApplicationRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.function.Supplier;

@Service
public class RosterAuditService {
    @Autowired
    private UserPermissionManager userPermissionManager;
    @Autowired
    private UserSignApplicationRegistry userSignApplicationRegistry;

    /** Main query lives inside a lambda argument, like the real Pages.pageResult call. */
    public Object getRosterAuditPage(Long companyId) {
        List<Long> shopIds = userPermissionManager.listShopIdByUserId(1L);
        return query(() -> userSignApplicationRegistry.lambdaQuery()
                .eq(UserSignApplication::getCompanyId, companyId)
                .in(UserSignApplication::getShopId, shopIds)
                .list());
    }

    private Object query(Supplier<Object> supplier) {
        return supplier.get();
    }
}