package com.acme.naming;

import com.acme.naming.entity.UserPermissionEntity;
import com.acme.naming.registry.UserPermissionRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class UserPermissionManager {
    @Autowired
    private UserPermissionRegistry userPermissionRegistry;

    public List<UserPermissionEntity> listByUser(Long userId) {
        return userPermissionRegistry.lambdaQuery()
                .eq(UserPermissionEntity::getUserId, userId)
                .list();
    }
}