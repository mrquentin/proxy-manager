packer {
  required_plugins {
    hcloud = {
      source  = "github.com/hetznercloud/hcloud"
      version = ">= 1.6.0"
    }
  }
}

source "hcloud" "debian12" {
  token         = var.hcloud_token
  image         = "debian-12"
  location      = "fsn1"
  server_type   = "cx22"
  ssh_username  = "root"
  snapshot_name = "proxy-manager-${var.build_version}-{{timestamp}}"
  snapshot_labels = {
    app           = "proxy-manager"
    build_version = var.build_version
    base_os       = "debian-12"
  }
}

build {
  sources = ["source.hcloud.debian12"]

  # Upload pre-built control plane binaries (arch-specific)
  provisioner "file" {
    source      = "files/controlplane-amd64"
    destination = "/tmp/controlplane-amd64"
  }

  provisioner "file" {
    source      = "files/controlplane-arm64"
    destination = "/tmp/controlplane-arm64"
  }

  # Upload config files
  provisioner "file" {
    source      = "config/"
    destination = "/tmp/config/"
  }

  # Run provisioning scripts in order
  provisioner "shell" {
    scripts = [
      "scripts/01-base.sh",
      "scripts/02-caddy.sh",
      "scripts/03-wireguard.sh",
      "scripts/04-controlplane.sh",
      "scripts/99-cleanup.sh",
    ]
    environment_vars = [
      "DEBIAN_FRONTEND=noninteractive",
      "BUILD_VERSION=${var.build_version}",
      "GO_VERSION=${var.go_version}",
    ]
  }
}
