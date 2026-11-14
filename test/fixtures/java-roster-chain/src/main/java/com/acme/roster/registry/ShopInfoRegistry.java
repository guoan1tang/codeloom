package com.acme.roster.registry;

import com.acme.roster.entity.ShopInfo;
import com.acme.roster.mapper.ShopInfoMapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class ShopInfoRegistry extends ServiceImpl<ShopInfoMapper, ShopInfo> {
}