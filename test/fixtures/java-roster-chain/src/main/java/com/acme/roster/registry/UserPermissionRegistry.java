package com.acme.roster.registry;

import com.acme.roster.entity.UserPermission;
import com.acme.roster.mapper.UserPermissionMapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class UserPermissionRegistry extends ServiceImpl<UserPermissionMapper, UserPermission> {
}