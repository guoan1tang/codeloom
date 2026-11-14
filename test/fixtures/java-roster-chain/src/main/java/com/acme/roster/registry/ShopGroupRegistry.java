package com.acme.roster.registry;

import com.acme.roster.entity.ShopGroup;
import com.acme.roster.mapper.ShopGroupMapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class ShopGroupRegistry extends ServiceImpl<ShopGroupMapper, ShopGroup> {
}