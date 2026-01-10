#!/bin/bash

PASSWORD=""
while [ -z "$PASSWORD" ]; do
    read -p "默认密码（必填，用于 WEBUI 和协议 token，仅支持英文和数字）: " PASSWORD
done

ENABLE_WEBUI="true"
WEBUI_PORT="3080"
SERVICE_PORTS["$WEBUI_PORT"]=1
ENABLE_HEADLESS="false"

AUTO_LOGIN_QQ=""

declare -A SERVICE_PORTS

# 交互式配置
while :; do
    clear
    echo "------------------------"
    echo "请选择服务设置："
    echo "1) 设置 WebUI 配置页端口，默认 3080"
    echo "2) 设置自动登录 QQ 号"
    echo "3) 启用无头模式（无头模式省内存，有头模式较稳定）"
    echo "4) 添加映射端口"
    echo "0) 完成配置"
    printf "输入选项: "
    read choice # 改用不带参数的 read 兼容dash

    case $choice in
        0)
            break ;;
        1)
            while true; do
                read -p "WebUI 端口: " port
                [[ "$port" =~ ^[0-9]+$ ]] || { echo "错误：端口必须是数字！"; continue; }
                WEBUI_PORT=${port}
                break
            done
            SERVICE_PORTS["$WEBUI_PORT"]=1
            ;;
        2)
          read -p "自动登录 QQ 号（留空则不自动登录）: " AUTO_LOGIN_QQ
          ;;
        3)
            ENABLE_HEADLESS="true"
            ;;
        4)
            while true; do
                read -p "端口号: " port
                [[ "$port" =~ ^[0-9]+$ ]] || { echo "错误：端口必须是数字！"; continue; }
                SERVICE_PORTS["$port"]=1
                break
            done
            ;;
        *)
            echo "无效选项"
            ;;
    esac
done

docker_mirror=""
PMHQ_TAG="latest"
LLBOT_TAG="latest"

# Docker 镜像源列表
DOCKER_MIRRORS=(
  "docker.1ms.run"
  "hub.rat.dev"
  "001090.xyz"
)

# 测试镜像源是否可用
test_mirror() {
  local mirror=$1
  local tag=$2
  echo "测试镜像源: ${mirror} ..." >&2
  if docker manifest inspect "${mirror}/linyuchen/llbot:${tag}" > /dev/null 2>&1; then
    return 0
  fi
  return 1
}

# 查找可用的镜像源
find_available_mirror() {
  local tag=$1
  for mirror in "${DOCKER_MIRRORS[@]}"; do
    if test_mirror "$mirror" "$tag"; then
      echo "找到可用镜像源: ${mirror}" >&2
      echo "${mirror}/"
      return 0
    fi
    echo "镜像源 ${mirror} 不可用" >&2
  done
  echo "所有镜像源均不可用，将使用官方源" >&2
  echo ""
  return 1
}

read -p "是否使用docker镜像源(y/n): " use_docker_mirror

if [[ "$use_docker_mirror" =~ ^[yY]$ ]]; then
  echo "正在获取最新版本信息..."
  
  # 获取PMHQ最新标签
  PMHQ_RELEASE=$(curl -s -L "https://gh-proxy.com/https://api.github.com/repos/linyuchen/PMHQ/releases/latest")
  if [ $? -eq 0 ]; then
    PMHQ_TAG=$(echo "$PMHQ_RELEASE" | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4 | sed 's/^v//')
    if [ -z "$PMHQ_TAG" ]; then
      echo "警告: 无法解析PMHQ版本号，镜像源可能不支持latest标签"
      echo "请手动指定版本号或不使用镜像源"
      PMHQ_TAG="latest"
    else
      echo "PMHQ 最新版本: $PMHQ_TAG"
    fi
  else
    echo "警告: 无法获取PMHQ最新版本，使用latest"
  fi
  
  # 获取LLBot最新标签
  LLBOT_RELEASE=$(curl -s -L "https://gh-proxy.com/https://api.github.com/repos/LLOneBot/LuckyLilliaBot/releases/latest")
  if [ $? -eq 0 ]; then
    LLBOT_TAG=$(echo "$LLBOT_RELEASE" | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4 | sed 's/^v//')
    if [ -z "$LLBOT_TAG" ]; then
      echo "警告: 无法解析LLBot版本号，镜像源可能不支持latest标签"
      echo "请手动指定版本号或不使用镜像源"
      LLBOT_TAG="latest"
    else
      echo "LLBot 最新版本: $LLBOT_TAG"
    fi
  else
    echo "警告: 无法获取LLBot最新版本，使用latest"
  fi

  echo "正在检测可用的镜像源..."
  docker_mirror=$(find_available_mirror "$LLBOT_TAG")
fi
# 生成docker-compose.yml（使用双引号包裹并保留转义）
cat << EOF > docker-compose.yml
services:
  pmhq:
    image: ${docker_mirror}linyuchen/pmhq:${PMHQ_TAG}
    container_name: pmhq
    privileged: true
    environment:
      - ENABLE_HEADLESS=${ENABLE_HEADLESS}
      - AUTO_LOGIN_QQ=${AUTO_LOGIN_QQ}
    networks:
      - app_network
    volumes:
      - qq_volume:/root/.config/QQ
      - llbot_data:/app/llbot/data

  llbot:
    image: ${docker_mirror}linyuchen/llbot:${LLBOT_TAG}
$([ ${#SERVICE_PORTS[@]} -gt 0 ] && echo "    ports:" && for port in "${!SERVICE_PORTS[@]}"; do echo "      - \"${port}:${port}\""; done)

    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - ENABLE_SATORI=${ENABLE_SATORI}
      - SATORI_PORT=${SATORI_PORT}
      - SATORI_TOKEN=${SATORI_TOKEN}
      - ENABLE_WEBUI=${ENABLE_WEBUI}
      - WEBUI_PORT=${WEBUI_PORT}
      - WEBUI_TOKEN=${PASSWORD}

    networks:
      - app_network
    volumes:
      - qq_volume:/root/.config/QQ
      - llbot_data:/app/llbot/data
    depends_on:
      - pmhq

volumes:
  qq_volume:
  llbot_data:

networks:
  app_network:
    driver: bridge
EOF

printLogin(){
    if [ "$ENABLE_WEBUI" == "true" ]; then
        echo "浏览器打开 http://localhost:${WEBUI_PORT} WebUI 页面进行登录"
    else
        echo "进入容器日志扫码进行登录"
    fi
}

# 检查root权限
if [ "$(id -u)" -ne 0 ]; then
    echo "没有 root 权限，请手动运行 sudo docker compose up -d"
    printLogin
    exit 1
fi
if ! command -v docker &> /dev/null; then
  echo "没有安装 Docker！安装后运行 sudo docker compose up -d"
  printLogin
  exit 1
fi
docker compose up -d

printLogin